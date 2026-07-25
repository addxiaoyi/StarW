/**
 * OpenStar 传输通道抽象
 * 抽象 CLI ↔ Desktop ↔ MCP ↔ Core 之间的通信介质
 */

import type {
  BaseRequest,
  BaseResponse,
  BaseEvent,
} from "./messages.js"

// ============= 传输层接口 =============

export interface Transport {
  /** 启动传输层 */
  start(): Promise<void>
  /** 停止传输层 */
  stop(): Promise<void>
  /** 发送请求并等待响应 */
  request(req: BaseRequest): Promise<BaseResponse>
  /** 发送单向通知（无响应） */
  notify(method: string, params?: Record<string, unknown>): void
  /** 接收服务端推送事件 */
  onEvent(handler: (event: BaseEvent) => void): void
  /** 连接状态 */
  readonly connected: boolean
}

// ============= 内置通道类型 =============

export type ChannelKind = "stdio" | "http" | "ipc" | "websocket"

export interface ChannelOptions {
  kind: ChannelKind
  /** stdio: 目标命令 */
  command?: string
  /** stdio/http/ipc: 连接地址 */
  address?: string
  /** http: 端口 */
  port?: number
  /** websocket: TLS */
  tls?: boolean
  /** 启动超时（ms） */
  timeout?: number
}

/**
 * 创建指定类型的通道
 */
export async function createChannel(
  options: ChannelOptions
): Promise<Transport> {
  switch (options.kind) {
    case "stdio":
      if (!options.command) {
        throw new Error("stdio channel requires a command")
      }
      return createStdioChannel(options.command)

    case "http":
      return createHttpChannel(options.address ?? "127.0.0.1", options.port ?? 3000)

    case "ipc":
      return createIpcChannel(options.address ?? "")

    default:
      throw new Error(`Unsupported channel kind: ${options.kind}`)
  }
}

// ============= Stdio 通道实现 =============

interface StdioTransport extends Transport {
  start(): Promise<void>
  stop(): Promise<void>
  request(req: BaseRequest): Promise<BaseResponse>
  notify(method: string, params?: Record<string, unknown>): void
  onEvent(handler: (event: BaseEvent) => void): void
  readonly connected: boolean
}

async function createStdioChannel(command: string): Promise<StdioTransport> {
  const { spawn } = await import("child_process")

  const child = spawn(command, [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  })

  let connected = true
  let eventHandler: ((event: BaseEvent) => void) | null = null
  const pending = new Map<string | number, {
    resolve: (v: BaseResponse) => void
    reject: (e: unknown) => void
  }>()
  let buffer = ""

  child.stdout!.on("data", (data: Buffer) => {
    buffer += data.toString()
    const lines = buffer.split("\n")
    buffer = lines.pop()!

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const msg = JSON.parse(trimmed) as BaseResponse | BaseEvent

        if ("id" in msg && msg.id !== undefined) {
          // Response
          const pendingReq = pending.get(msg.id)
          if (pendingReq) {
            pending.delete(msg.id)
            pendingReq.resolve(msg)
          }
        } else if ("method" in msg) {
          // Event
          eventHandler?.(msg as BaseEvent)
        }
      } catch {
        // ignore malformed lines
      }
    }
  })

  child.on("exit", () => {
    connected = false
    for (const [, p] of pending) {
      p.reject(new Error("Channel closed"))
    }
    pending.clear()
  })

  const send = (data: unknown) => {
    if (connected) {
      child.stdin!.write(JSON.stringify(data) + "\n")
    }
  }

  return {
    get connected() { return connected },

    async start() {},
    async stop() {
      connected = false
      child.kill()
    },

    request(req: BaseRequest): Promise<BaseResponse> {
      return new Promise((resolve, reject) => {
        if (!connected) {
          reject(new Error("Channel not connected"))
          return
        }
        pending.set(req.id, { resolve, reject })
        send(req)
        // Timeout
        setTimeout(() => {
          if (pending.has(req.id)) {
            pending.delete(req.id)
            reject(new Error("Request timeout"))
          }
        }, 30_000)
      })
    },

    notify(method, params) {
      send({ jsonrpc: "2.0", method, params })
    },

    onEvent(handler) {
      eventHandler = handler
    },
  }
}

// ============= HTTP 通道实现 =============

async function createHttpChannel(
  host: string,
  port: number
): Promise<Transport> {
  let connected = false
  let eventHandler: ((event: BaseEvent) => void) | null = null

  const baseUrl = `http://${host}:${port}`

  async function request(req: BaseRequest): Promise<BaseResponse> {
    const res = await fetch(`${baseUrl}/acp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as BaseResponse
  }

  return {
    get connected() { return connected },

    async start() { connected = true },
    async stop() { connected = false },

    request,
    notify() {
      // HTTP 单向，不支持推送事件
    },
    onEvent(handler) { eventHandler = handler },
  }
}

// ============= IPC 通道实现 =============

async function createIpcChannel(socketPath: string): Promise<Transport> {
  const { createConnection } = await import("net")
  let connected = false
  let eventHandler: ((event: BaseEvent) => void) | null = null
  const pending = new Map<string | number, {
    resolve: (v: BaseResponse) => void
    reject: (e: unknown) => void
  }>()
  let buffer = ""

  const socket = createConnection(socketPath)

  socket.on("connect", () => { connected = true })
  socket.on("data", (data: Buffer) => {
    buffer += data.toString()
    const lines = buffer.split("\n")
    buffer = lines.pop()!

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const msg = JSON.parse(trimmed) as BaseResponse | BaseEvent

        if ("id" in msg && msg.id !== undefined) {
          const p = pending.get(msg.id)
          if (p) { pending.delete(msg.id); p.resolve(msg) }
        } else if ("method" in msg) {
          eventHandler?.(msg as BaseEvent)
        }
      } catch {
        // ignore
      }
    }
  })

  socket.on("close", () => {
    connected = false
    for (const [, p] of pending) p.reject(new Error("IPC closed"))
    pending.clear()
  })

  const send = (data: unknown) => {
    if (connected) socket.write(JSON.stringify(data) + "\n")
  }

  return {
    get connected() { return connected },

    async start() {
      await new Promise<void>((resolve) => {
        socket.once("connect", resolve)
      })
    },
    async stop() {
      connected = false
      socket.end()
    },

    request(req: BaseRequest): Promise<BaseResponse> {
      return new Promise((resolve, reject) => {
        if (!connected) { reject(new Error("IPC not connected")); return }
        pending.set(req.id, { resolve, reject })
        send(req)
        setTimeout(() => {
          if (pending.has(req.id)) { pending.delete(req.id); reject(new Error("Request timeout")) }
        }, 30_000)
      })
    },

    notify(method, params) {
      send({ jsonrpc: "2.0", method, params })
    },

    onEvent(handler) { eventHandler = handler },
  }
}

// ============= 辅助函数 =============

/**
 * 通过指定传输层发送请求（供外部模块如 sandbox 直接调用）
 */
export async function call<T = unknown>(
  transport: Transport,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  const id = Math.random()
  const req: BaseRequest = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  }
  const res = await transport.request(req)

  if (res.error) {
    throw new Error(`[${res.error.code}] ${res.error.message}`)
  }
  return res.result as T
}

export interface Client {
  transport: Transport
  /** 发送请求 */
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /** 发送通知 */
  notify(method: string, params?: Record<string, unknown>): void
  /** 订阅事件 */
  on(method: string, handler: (params: Record<string, unknown>) => void): void
  /** 断开连接 */
  disconnect(): Promise<void>
}

/**
 * 创建 Protocol 客户端
 */
export async function createClient(options: ChannelOptions): Promise<Client> {
  const transport = await createChannel(options)
  await transport.start()

  const listeners = new Map<string, (params: Record<string, unknown>) => void>()

  transport.onEvent((event) => {
    listeners.get(event.method)?.(event.params)
  })

  let idCounter = 0

  return {
    transport,

    async call<T = unknown>(
      method: string,
      params?: Record<string, unknown>
    ): Promise<T> {
      const id = ++idCounter
      const req: BaseRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      }
      const res = await transport.request(req)

      if (res.error) {
        throw new Error(`[${res.error.code}] ${res.error.message}`)
      }
      return res.result as T
    },

    notify(method, params) {
      transport.notify(method, params)
    },

    on(method, handler) {
      listeners.set(method, handler)
    },

    async disconnect() {
      await transport.stop()
    },
  }
}
