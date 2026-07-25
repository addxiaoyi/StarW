/**
 * 增强的命令历史管理器
 * 支持上下箭头导航、搜索、持久化
 */

import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import readline from 'readline'

export interface HistoryOptions {
  maxSize?: number
  persistent?: boolean
  historyFile?: string
}

const DEFAULT_HISTORY_SIZE = 100
const DEFAULT_HISTORY_FILE = path.join(os.homedir(), '.openstar', 'history.json')

export class CommandHistory {
  private history: string[] = []
  private historyIndex: number = -1
  private currentInput: string = ''
  private options: Required<HistoryOptions>
  private rl?: readline.Interface
  private navigated: boolean = false

  constructor(options: HistoryOptions = {}) {
    this.options = {
      maxSize: options.maxSize || DEFAULT_HISTORY_SIZE,
      persistent: options.persistent ?? true,
      historyFile: options.historyFile || DEFAULT_HISTORY_FILE
    }
  }

  // 初始化
  async initialize(rl?: readline.Interface): Promise<void> {
    this.rl = rl

    if (this.options.persistent) {
      await this.load()
    }

    // 设置readline事件
    if (rl) {
      this.setupReadlineEvents(rl)
    }
  }

  // 加载历史文件
  async load(): Promise<void> {
    try {
      const file = await fs.readFile(this.options.historyFile, 'utf8')
      const parsed = JSON.parse(file)
      this.history = Array.isArray(parsed) ? parsed : []

      // 限制大小
      if (this.history.length > this.options.maxSize) {
        this.history = this.history.slice(-this.options.maxSize)
      }
    } catch (e) {
      // 文件不存在，忽略
      this.history = []
    }
  }

  // 保存历史文件
  async save(): Promise<void> {
    if (!this.options.persistent) return

    try {
      await fs.mkdir(path.dirname(this.options.historyFile), { recursive: true })
      await fs.writeFile(this.options.historyFile, JSON.stringify(this.history, null, 2), 'utf8')
    } catch (e) {
      console.warn('⚠ 命令历史保存失败:', e)
    }
  }

  // 设置readline事件
  private setupReadlineEvents(rl: readline.Interface): void {

    // 箭头键导航
    rl.on('keypress', (str: string, key: readline.Key) => {
      // 上箭头 - 后退历史
      if (key.name === 'up') {
        this.navigateHistory(-1, rl)
      }
      // 下箭头 - 前进历史
      else if (key.name === 'down') {
        this.navigateHistory(1, rl)
      }
      // Tab - 自动补全
      else if (str === '\t') {
        // TODO: 实现自动补全
        this.handleTabCompletion(rl)
      }
      // 清空导航状态
      else if (key.name === 'return' || key.name === 'escape') {
        this.navigated = false
        this.currentInput = ''
      }
      else if (!key.ctrl && !key.meta) {
        // 正常输入
        if (!this.navigated) {
          this.currentInput += str
        } else {
          this.navigated = false
          this.currentInput = str
        }
      }
    })
  }

  // 导航历史
  private navigateHistory(direction: number, rl: readline.Interface): void {
    if (this.history.length === 0) return

    // 保存当前输入（第一次导航时）
    if (!this.navigated && this.currentInput) {
      this.navigated = true
      // 不保存临时输入到历史
    }

    // 更新索引
    if (direction < 0) { // Up
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++
      }
    } else { // Down
      if (this.historyIndex > 0) {
        this.historyIndex--
      } else if (this.historyIndex === 0) {
        this.historyIndex = -1
        this.currentInput = ''
      }
    }

    // 获取历史命令
    let line = ''
    if (this.historyIndex >= 0 && this.historyIndex < this.history.length) {
      line = this.history[this.historyIndex]
    }

    // 清空当前行并重新写入
    const lines = rl.getCursorPos().rows
    readline.moveCursor(process.stdout, 0, -lines)
    readline.clearScreenDown(process.stdout)

    rl.setPrompt('')
    rl.prompt()
    rl.write(line)

    this.currentInput = line
    this.navigated = true
  }

  // Tab补全
  private handleTabCompletion(rl: readline.Interface): void {
    // TODO: 实现命令补全逻辑
    const availableCommands = [
      '/help', '/status', '/skills', '/agents', '/theme',
      '/plugin', '/history', '/clear', '/exit', '/quit'
    ]

    const currentLine = rl.line
    const match = availableCommands.find(cmd => cmd.startsWith(currentLine))

    if (match) {
      readline.moveCursor(process.stdout, 0, -rl.getCursorPos().rows)
      readline.clearScreenDown(process.stdout)
      rl.setPrompt('')
      rl.prompt()
      rl.write(match)
    }
  }

  // 添加命令到历史
  add(command: string): void {
    if (!command || command.trim() === '') return

    // 避免重复
    if (this.history.length > 0 && this.history[0] === command) {
      return
    }

    // 添加到历史
    this.history.unshift(command.trim())

    // 限制大小
    if (this.history.length > this.options.maxSize) {
      this.history = this.history.slice(0, this.options.maxSize)
    }

    // 持久化
    if (this.options.persistent) {
      this.save().catch(() => {})
    }
  }

  // 获取历史
  getHistory(): string[] {
    return [...this.history]
  }

  // 获取最近命令
  getRecent(limit: number = 10): string[] {
    return this.history.slice(0, limit)
  }

  // 搜索历史
  search(query: string): string[] {
    return this.history.filter(cmd => cmd.includes(query))
  }

  // 清空历史
  clear(): void {
    this.history = []
    this.historyIndex = -1
    this.currentInput = ''

    if (this.options.persistent) {
      this.save().catch(() => {})
    }
  }

  // 获取统计信息
  getStats(): { count: number; unique: number } {
    const unique = new Set(this.history).size
    return { count: this.history.length, unique }
  }

  // 关闭
  close(): void {
    this.save().catch(() => {})
  }
}

// 导出单例
const commandHistory = new CommandHistory()

export { commandHistory }
