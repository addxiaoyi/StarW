/**
 * Beautiful Terminal Table Component
 * Inspired by Warp's terminal UI
 */

export interface TableOptions {
  head?: string[]
  colWidths?: number[]
  style?: TableStyle
  border?: boolean
}

export interface TableStyle {
  border?: boolean
  compact?: boolean
}

export class Table {
  private rows: string[][] = []
  private options: TableOptions

  constructor(options: TableOptions = {}) {
    this.options = options
  }

  push(row: string[]): void {
    this.rows.push(row)
  }

  toString(): string {
    const { head = [], colWidths = [], style = {} } = this.options
    const { compact = false } = style

    if (this.rows.length === 0 && head.length === 0) {
      return ''
    }

    // Calculate column widths
    const allRows = head.length > 0 ? [head, ...this.rows] : this.rows
    const widths = colWidths.length > 0
      ? colWidths
      : this.calculateWidths(allRows)

    // Build table
    const lines: string[] = []

    // Top border
    if (this.options.border !== false) {
      const border = '─'.repeat(widths.reduce((a, b) => a + b + 3, 1))
      lines.push(`┌${border}┐`)
    }

    // Header
    if (head.length > 0) {
      const headerRow = head.map((cell, i) =>
        this.padRight(cell, widths[i])
      ).join(' │ ')
      lines.push(`│ ${headerRow} │`)

      // Header border
      if (this.options.border !== false) {
        const headerBorder = widths.map(w => '─'.repeat(w)).join('─┼─')
        lines.push(`├─${headerBorder}─┤`)
      }
    }

    // Data rows
    for (const row of this.rows) {
      const cells = row.map((cell, i) => this.padRight(cell, widths[i]))
      lines.push(`│ ${cells.join(' │ ')} │`)
    }

    // Bottom border
    if (this.options.border !== false) {
      const border = '─'.repeat(widths.reduce((a, b) => a + b + 3, 1))
      lines.push(`└${border}┘`)
    }

    return lines.join('\n')
  }

  private calculateWidths(rows: string[][]): number[] {
    if (rows.length === 0) return []

    const numCols = Math.max(...rows.map(r => r.length))
    const widths: number[] = new Array(numCols).fill(0)

    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        const cellLength = this.stripAnsi(row[i]).length
        widths[i] = Math.max(widths[i], cellLength)
      }
    }

    return widths
  }

  private padRight(str: string, width: number): string {
    const length = this.stripAnsi(str).length
    const padding = width - length
    return str + ' '.repeat(Math.max(0, padding))
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[\d+m/g, '')
  }
}

// Color utilities

// Color constants only - no duplicate function exports
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
}

export default Table
