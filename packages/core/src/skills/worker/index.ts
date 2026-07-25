/**
 * Skill Worker - 技能执行沙箱
 * 每个技能运行在独立子进程中，通过 IPC 与主进程通信
 */

import { createClient, AllMethods, ErrorCode, SkillExecuteParams } from '@openstar/protocol'

// ============= Worker 环境变量 =============

const MAIN_SOCKET = process.env.OPENSTAR_MAIN_SOCKET!
const SKILL_NAME = process.env.OPENSTAR_SKILL_NAME!
const WORKER_ID = process.env.OPENSTAR_WORKER_ID!

if (!MAIN_SOCKET || !SKILL_NAME) {
  console.error('[SkillWorker] Missing required env: OPENSTAR_MAIN_SOCKET, OPENSTAR_SKILL_NAME')
  process.exit(1)
}

// ============= Worker 状态 =============

interface WorkerState {
  skillName: string
  workerId: string
  startedAt: number
  execCount: number
  lastError: string | null
}

const state: WorkerState = {
  skillName: SKILL_NAME,
  workerId: WORKER_ID,
  startedAt: Date.now(),
  execCount: 0,
  lastError: null,
}

// ============= 动态加载技能实现 =============

interface SkillModule {
  execute(args: Record<string, unknown>): Promise<unknown>
  cleanup?(): Promise<void> | void
  metadata?: {
    timeout?: number  // ms
    memoryLimit?: number  // MB
  }
}

async function loadSkill(skillName: string): Promise<SkillModule> {
  // 1. 尝试从 skills/ 目录加载（本地技能）
  try {
    const localPath = `../../skills/${skillName}.ts`
    const mod = await import(localPath)
    return mod as SkillModule
  } catch {
    // not found locally
  }

  // 2. 尝试从 node_modules 加载（npm 包技能）
  try {
    const pkgPath = `@openstar/skill-${skillName}`
    const mod = await import(pkgPath)
    return mod as SkillModule
  } catch {
    // not found
  }

  throw new Error(`Skill '${skillName}' not found in local skills/ or node_modules`)
}

// ============= 执行循环 =============

async function main() {
  console.log(`[SkillWorker:${WORKER_ID}] Starting skill '${SKILL_NAME}' on socket ${MAIN_SOCKET}`)

  // 连接主进程
  const client = await createClient({
    kind: 'ipc',
    address: MAIN_SOCKET,
  })

  console.log(`[SkillWorker:${WORKER_ID}] Connected to main process`)

  // 注册技能执行处理器
  client.on('skills/execute', async (params: unknown) => {
    state.execCount++
    const start = Date.now()

    try {
      // 参数校验
      const parsed = SkillExecuteParams.safeParse(params)
      if (!parsed.success) {
        return {
          success: false,
          error: { code: ErrorCode.INVALID_PARAMS, message: 'Invalid params', data: parsed.error.format() }
        }
      }

      const { args } = parsed.data

      // 加载技能模块（首次懒加载，后续缓存）
      const skill = await loadSkill(SKILL_NAME)

      // 执行（带超时保护）
      const timeout = skill.metadata?.timeout ?? 60_000
      const result = await Promise.race([
        skill.execute(args ?? {}),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Skill execution timed out after ${timeout}ms`)), timeout)
        ),
      ])

      const duration = Date.now() - start
      console.log(`[SkillWorker:${WORKER_ID}] Executed in ${duration}ms`)

      return { success: true, result, duration, execCount: state.execCount }
    } catch (err) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      state.lastError = message

      console.error(`[SkillWorker:${WORKER_ID}] Error after ${duration}ms:`, message)

      return {
        success: false,
        error: { code: ErrorCode.SKILL_EXECUTION_FAILED, message, duration },
      }
    }
  })

  // 注册健康检查
  client.on('skills/ping', async () => {
    return {
      workerId: state.workerId,
      skillName: state.skillName,
      uptime: Date.now() - state.startedAt,
      execCount: state.execCount,
      lastError: state.lastError,
    }
  })

  // 注册关闭信号
  client.on('skills/stop', async () => {
    console.log(`[SkillWorker:${WORKER_ID}] Received stop signal`)
    try {
      const skill = await loadSkill(SKILL_NAME)
      await skill.cleanup?.()
    } catch {
      // ignore cleanup errors
    }
    await client.disconnect()
    process.exit(0)
  })

  // 通知主进程 Worker 已就绪
  client.notify('skills/worker_ready', {
    workerId: state.workerId,
    skillName: state.skillName,
  })
}

main().catch((err) => {
  console.error('[SkillWorker] Fatal:', err)
  process.exit(1)
})
