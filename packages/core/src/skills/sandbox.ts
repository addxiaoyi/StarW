/**
 * SkillSandbox - 技能沙箱管理器
 * 负责启动、监控、调度独立 Worker 进程
 */

import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import path from 'path'
import { Server as IpcServer, createConnection } from 'net'
import { call, type BaseResponse, type Transport } from '@openstar/protocol'
import { ErrorCode } from '@openstar/protocol'

// ============= 临时 IPC Transport（sandbox 内联使用）============

/** 为单个请求创建临时 IPC 传输层 */
function createIpcTransport(socketPath: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let connected = false
    let buffer = ''
    const pending = new Map<number | string, {
      resolve: (v: BaseResponse) => void
      reject: (e: unknown) => void
    }>()

    socket.on('connect', () => {
      connected = true
    })

    socket.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()!

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed)
          if ('id' in msg && msg.id !== undefined) {
            const p = pending.get(msg.id)
            if (p) { pending.delete(msg.id as number); p.resolve(msg as BaseResponse) }
          }
        } catch {
          // ignore
        }
      }
    })

    socket.on('error', reject)
    socket.on('close', () => {
      connected = false
      for (const [, p] of pending) p.reject(new Error('IPC closed'))
      pending.clear()
    })

    const send = (data: unknown) => {
      if (connected) socket.write(JSON.stringify(data) + '\n')
    }

    const transport: Transport = {
      get connected() { return connected },
      async start() {},
      async stop() { connected = false; socket.end() },
      request(req) {
        return new Promise((res, rej) => {
          if (!connected) { rej(new Error('IPC not connected')); return }
          pending.set(req.id, { resolve: res, reject: rej })
          send(req)
          setTimeout(() => {
            if (pending.has(req.id)) { pending.delete(req.id as number); rej(new Error('Request timeout')) }
          }, 30_000)
        }) as ReturnType<Transport['request']>
      },
      notify(method, params) { send({ jsonrpc: '2.0', method, params }) },
      onEvent() {},
    }

    resolve(transport)
  })
}

// ============= 沙箱配置 =============

export interface SkillSandboxOptions {
  /** 工作目录（放 socket 文件） */
  socketDir?: string
  /** Worker 启动超时（ms） */
  startupTimeout?: number
  /** 最大并发 Worker 数 */
  maxWorkers?: number
  /** Worker 空闲存活时间（ms），超时后自动终止 */
  idleTimeout?: number
  /** 每个 Worker 的执行超时（ms） */
  execTimeout?: number
}

const DEFAULT_OPTIONS: Required<SkillSandboxOptions> = {
  socketDir: '/tmp/openstar-skills',
  startupTimeout: 10_000,
  maxWorkers: 10,
  idleTimeout: 300_000,  // 5 分钟空闲后自动销毁 Worker
  execTimeout: 60_000,
}

// ============= Worker 信息 =============

interface WorkerInfo {
  id: string
  skillName: string
  process: ChildProcess
  socketPath: string
  /** 上次执行时间 */
  lastExecAt: number
  /** 执行计数 */
  execCount: number
  /** 是否已就绪 */
  ready: boolean
  /** 空闲定时器 */
  idleTimer: NodeJS.Timeout | null
}

// ============= 沙箱实现 =============

export class SkillSandbox {
  private options: Required<SkillSandboxOptions>
  private workers = new Map<string, WorkerInfo>()
  private pending = new Map<string, Array<(w: WorkerInfo) => void>>()

  constructor(options: SkillSandboxOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  // ============= 生命周期 =============

  async start(): Promise<void> {
    // 确保 socket 目录存在
    try {
      const { mkdirSync } = await import('fs')
      mkdirSync(this.options.socketDir, { recursive: true })
    } catch {
      // ignore
    }
    console.log(`[SkillSandbox] Started, socket dir: ${this.options.socketDir}`)
  }

  async stop(): Promise<void> {
    console.log(`[SkillSandbox] Stopping ${this.workers.size} workers...`)
    await Promise.allSettled(
      Array.from(this.workers.values()).map((w) => this.destroyWorker(w.id))
    )
    this.workers.clear()
    console.log('[SkillSandbox] Stopped')
  }

  // ============= Worker 管理 =============

  /**
   * 获取或创建指定技能的 Worker
   */
  async getWorker(skillName: string): Promise<WorkerInfo> {
    // 找空闲的同名 Worker
    for (const w of this.workers.values()) {
      if (w.skillName === skillName && w.ready) {
        this.refreshIdleTimer(w)
        return w
      }
    }

    // 未达上限则创建新的
    if (this.workers.size < this.options.maxWorkers) {
      return this.spawnWorker(skillName)
    }

    // 满了，等待空闲槽位
    return new Promise((resolve) => {
      const waiting = this.pending.get(skillName) ?? []
      waiting.push(resolve)
      this.pending.set(skillName, waiting)
    })
  }

  /**
   * 在指定 Worker 上执行技能
   */
  async execute(
    skillName: string,
    args: Record<string, unknown> = {}
  ): Promise<unknown> {
    const worker = await this.getWorker(skillName)
    const transport = await createIpcTransport(worker.socketPath)
    try {
      const result = await call(transport, 'skills/execute', {
        skill_name: skillName,
        args,
      })
      return result
    } finally {
      await transport.stop()
    }
  }

  // ============= 内部方法 =============

  private async spawnWorker(skillName: string): Promise<WorkerInfo> {
    const id = randomUUID().slice(0, 8)
    const socketPath = path.join(this.options.socketDir, `worker-${id}.sock`)

    // 清理旧 socket 文件
    try {
      const { unlinkSync, existsSync } = await import('fs')
      if (existsSync(socketPath)) unlinkSync(socketPath)
    } catch {
      // ignore
    }

    // 创建 IPC Server 监听 Worker 连接
    const ipcServer = new IpcServer((socket) => {
      // Worker 通过这个 socket 连接上来
      // 简单中继：把 Worker stdout JSON 转发给连接方
      let buffer = ''
      socket.on('data', (data: Buffer) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const msg = JSON.parse(trimmed)
            socket.write(JSON.stringify(msg) + '\n')
          } catch {
            // pass through raw
          }
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      ipcServer.listen(socketPath, () => resolve())
      ipcServer.on('error', reject)
    })

    // 启动 Worker 子进程
    const workerPath = path.resolve(
      import.meta.dirname ?? __dirname,
      'worker/index.js'
    )

    const child = spawn(
      process.execPath,
      [workerPath],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          OPENSTAR_WORKER_ID: id,
          OPENSTAR_SKILL_NAME: skillName,
          OPENSTAR_MAIN_SOCKET: socketPath,
        },
        detached: false,
      }
    )

    // 收集 stdout（JSON-RPC 消息）
    let buffer = ''
    child.stdout!.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()!

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed)
          // worker_ready 信号
          if (msg.method === 'skills/worker_ready') {
            worker.ready = true
            this.refreshIdleTimer(worker)
          }
        } catch {
          // non-JSON log
          console.log(`[SkillWorker:${id}]`, trimmed)
        }
      }
    })

    // 收集 stderr
    child.stderr!.on('data', (data: Buffer) => {
      console.error(`[SkillWorker:${id} stderr]`, data.toString().trim())
    })

    child.on('exit', (code) => {
      console.log(`[SkillWorker:${id}] Exited with code ${code}`)
      this.workers.delete(id)
      ipcServer.close()
      this.drainPending(skillName)
    })

    const worker: WorkerInfo = {
      id,
      skillName,
      process: child,
      socketPath,
      lastExecAt: 0,
      execCount: 0,
      ready: false,
      idleTimer: null,
    }

    this.workers.set(id, worker)

    // 等待 Worker 就绪
    const timeout = setTimeout(() => {
      if (!worker.ready) {
        console.error(`[SkillWorker:${id}] Startup timeout, killing...`)
        this.destroyWorker(id)
      }
    }, this.options.startupTimeout)

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (worker.ready) {
          clearInterval(check)
          clearTimeout(timeout)
          resolve()
        }
      }, 100)
    })

    return worker
  }

  private async destroyWorker(id: string): Promise<void> {
    const w = this.workers.get(id)
    if (!w) return

    if (w.idleTimer) clearTimeout(w.idleTimer)
    w.process.kill()
    this.workers.delete(id)
  }

  private refreshIdleTimer(w: WorkerInfo): void {
    if (w.idleTimer) clearTimeout(w.idleTimer)
    w.lastExecAt = Date.now()
    w.idleTimer = setTimeout(() => {
      if (Date.now() - w.lastExecAt >= this.options.idleTimeout) {
        console.log(`[SkillSandbox] Worker ${w.id} idle timeout, destroying`)
        this.destroyWorker(w.id)
      }
    }, this.options.idleTimeout)
  }

  private drainPending(skillName: string): void {
    const waiting = this.pending.get(skillName)
    if (!waiting?.length) return

    const w = this.workers.get(skillName)
    if (w?.ready) {
      for (const resolve of waiting) resolve(w)
      this.pending.delete(skillName)
    }
  }

  // ============= 状态查询 =============

  getStatus() {
    return {
      totalWorkers: this.workers.size,
      maxWorkers: this.options.maxWorkers,
      workers: Array.from(this.workers.values()).map((w) => ({
        id: w.id,
        skillName: w.skillName,
        ready: w.ready,
        execCount: w.execCount,
        uptime: Date.now() - w.lastExecAt,
      })),
    }
  }
}

// ============= 导出单例 =============

let _sandbox: SkillSandbox | null = null

export function getSkillSandbox(options?: SkillSandboxOptions): SkillSandbox {
  if (!_sandbox) {
    _sandbox = new SkillSandbox(options)
  }
  return _sandbox
}
