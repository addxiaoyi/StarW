/**
 * StarCore TUI - 终端 UI 组件
 * 灵感来自 Warp 的现代化终端界面
 */

import { bold, cyan, green, yellow, red, dim, gray } from "picocolors"

// ============= 边框字符 =============

const BORDER = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  cross: "┼",
}

// ============= Table 组件 =============

export interface TableOptions {
  head?: string[]
  colWidths?: number[]
  style?: {
    border?: boolean
    compact?: boolean
  }
}

export class Table {
  private head: string[]
  private colWidths: number[]
  private rows: string[][]
  private border: boolean
  private compact: boolean

  constructor(options: TableOptions = {}) {
    this.head = options.head || []
    this.colWidths = options.colWidths || []
    this.rows = []
    this.border = options.style?.border ?? true
    this.compact = options.style?.compact ?? false
  }

  push(row: string[]): void {
    this.rows.push(row)
  }

  private pad(str: string, width: number): string {
    const len = this.stripAnsi(str).length
    const padding = width - len
    return str + " ".repeat(Math.max(0, padding))
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "")
  }

  private calculateWidths(): number[] {
    const widths = [...this.colWidths]

    // 根据表头计算
    if (this.head.length > 0) {
      for (let i = 0; i < this.head.length; i++) {
        const len = this.stripAnsi(this.head[i]).length
        widths[i] = Math.max(widths[i] || 0, len + 2)
      }
    }

    // 根据数据计算
    for (const row of this.rows) {
      for (let i = 0; i < row.length; i++) {
        const len = this.stripAnsi(row[i]).length
        widths[i] = Math.max(widths[i] || 0, len + 2)
      }
    }

    return widths
  }

  toString(): string {
    if (this.rows.length === 0 && this.head.length === 0) {
      return ""
    }

    const widths = this.calculateWidths()
    const lines: string[] = []

    // 顶部边框
    if (this.border) {
      const topLine = BORDER.topLeft + widths.map((w) => BORDER.horizontal.repeat(w)).join(BORDER.horizontal + BORDER.horizontal) + BORDER.topRight
      lines.push(cyan(topLine))
    }

    // 表头
    if (this.head.length > 0) {
      const headerCells = this.head.map((h, i) => this.pad(bold(h), widths[i]))
      const headerLine = this.border ? cyan(BORDER.vertical) + " " + headerCells.join(" " + cyan(BORDER.vertical) + " ") + " " + cyan(BORDER.vertical) : headerCells.join("  ")
      lines.push(headerLine)

      if (this.border) {
        const sepLine = BORDER.vertical + widths.map((w) => BORDER.horizontal.repeat(w)).join(BORDER.vertical + BORDER.vertical) + BORDER.vertical
        lines.push(cyan(sepLine))
      }
    }

    // 数据行
    for (const row of this.rows) {
      const cells = row.map((cell, i) => this.pad(cell, widths[i]))
      if (this.border) {
        lines.push(cyan(BORDER.vertical) + " " + cells.join(" " + cyan(BORDER.vertical) + " ") + " " + cyan(BORDER.vertical))
      } else {
        lines.push(cells.join("  "))
      }
    }

    // 底部边框
    if (this.border) {
      const bottomLine = BORDER.bottomLeft + widths.map((w) => BORDER.horizontal.repeat(w)).join(BORDER.horizontal + BORDER.bottomRight) + BORDER.bottomRight
      lines.push(cyan(bottomLine))
    }

    return lines.join("\n")
  }
}

// ============= Box 组件 =============

export interface BoxOptions {
  title?: string
  borderColor?: (str: string) => string
  titleColor?: (str: string) => string
}

export class Box {
  private content: string
  private title?: string
  private borderColor: (str: string) => string
  private titleColor: (str: string) => string
  private padding: number = 1

  constructor(content: string, options: BoxOptions = {}) {
    this.content = content
    this.title = options.title
    this.borderColor = options.borderColor || cyan
    this.titleColor = options.titleColor || bold
  }

  toString(): string {
    const lines = this.content.split("\n")
    const maxLen = Math.max(...lines.map((l) => this.stripAnsi(l).length))
    const width = maxLen + this.padding * 2 + 2

    const result: string[] = []

    // 顶部
    const topLine = BORDER.topLeft + BORDER.horizontal.repeat(width) + BORDER.topRight
    result.push(this.borderColor(topLine))

    // 标题行
    if (this.title) {
      const titleLen = this.stripAnsi(this.title).length
      const padding = width - titleLen - 2
      const leftPad = Math.floor(padding / 2)
      const rightPad = padding - leftPad
      const titleLine = BORDER.vertical + " " + " ".repeat(leftPad) + this.titleColor(this.title) + " ".repeat(rightPad) + " " + BORDER.vertical
      result.push(this.borderColor(titleLine))

      // 分隔线
      const sepLine = BORDER.vertical + BORDER.horizontal.repeat(width) + BORDER.vertical
      result.push(this.borderColor(sepLine))
    }

    // 内容
    for (const line of lines) {
      const contentLen = this.stripAnsi(line).length
      const padding = width - contentLen - 2
      const contentLine = BORDER.vertical + " " + line + " ".repeat(padding) + " " + BORDER.vertical
      result.push(this.borderColor(contentLine))
    }

    // 底部
    const bottomLine = BORDER.bottomLeft + BORDER.horizontal.repeat(width) + BORDER.bottomRight
    result.push(this.borderColor(bottomLine))

    return result.join("\n")
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "")
  }
}

// ============= 进度指示器 =============

export interface SpinnerOptions {
  frames?: string[]
  interval?: number
}

export class Spinner {
  private frames: string[]
  private interval: number
  private current: number = 0
  private text: string
  private active: boolean = false
  private timer?: NodeJS.Timeout

  constructor(options: SpinnerOptions = {}) {
    this.frames = options.frames || ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    this.interval = options.interval || 80
    this.text = ""
  }

  start(text?: string): void {
    this.active = true
    this.text = text || ""
    this.current = 0

    this.timer = setInterval(() => {
      this.current = (this.current + 1) % this.frames.length
      process.stdout.write(`\r${this.frames[this.current]} ${this.text}`)
    }, this.interval)
  }

  setText(text: string): void {
    this.text = text
  }

  stop(message?: string): void {
    this.active = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    if (message) {
      process.stdout.write(`\r${" ".repeat(50)}\r`)
      console.log(message)
    } else {
      process.stdout.write("\r" + " ".repeat(50) + "\r")
    }
  }

  succeed(text: string): void {
    this.stop(`${green("✓")} ${text}`)
  }

  fail(text: string): void {
    this.stop(`${red("✗")} ${text}`)
  }

  warning(text: string): void {
    this.stop(`${yellow("⚠")} ${text}`)
  }
}

// ============= 状态图标 =============

export const Status = {
  success: (text: string) => green("●") + " " + text,
  warning: (text: string) => yellow("◐") + " " + text,
  error: (text: string) => red("○") + " " + text,
  info: (text: string) => cyan("◆") + " " + text,
  loading: (text: string) => dim("◌") + " " + text,
  idle: (text: string) => dim("○") + " " + text,
}

// ============= Banner =============

export interface BannerOptions {
  title: string
  subtitle?: string
  version?: string
  width?: number
}

export const createBanner = (options: BannerOptions): string => {
  const { title, subtitle, version, width = 50 } = options
  const border = BORDER.topLeft + BORDER.horizontal.repeat(width - 2) + BORDER.topRight
  const bottom = BORDER.bottomLeft + BORDER.horizontal.repeat(width - 2) + BORDER.bottomRight

  const lines: string[] = []
  lines.push(cyan(border))

  // 标题行
  const titleLen = title.length + (version ? version.length + 3 : 0)
  const titlePadding = width - titleLen - 4
  const titleLine = BORDER.vertical + "  " + bold(cyan(title)) + (version ? " " + dim(`v${version}`) : "") + " ".repeat(titlePadding) + BORDER.vertical
  lines.push(titleLine)

  // 副标题
  if (subtitle) {
    const subPadding = width - subtitle.length - 4
    const subLine = BORDER.vertical + "  " + dim(subtitle) + " ".repeat(subPadding) + BORDER.vertical
    lines.push(subLine)
  }

  lines.push(cyan(bottom))

  return lines.join("\n")
}

// ============= 快捷方式 =============

export const box = (content: string, options?: BoxOptions) => new Box(content, options)
export const table = (options?: TableOptions) => new Table(options)
export const spinner = (options?: SpinnerOptions) => new Spinner(options)
export const banner = (options: BannerOptions) => createBanner(options)

// 导出颜色工具
export { bold, cyan, green, yellow, red, dim, gray }
