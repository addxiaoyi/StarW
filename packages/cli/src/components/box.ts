/**
 * Terminal Box Component
 * Creates bordered boxes for terminal output
 */

export interface BoxOptions {
  title?: string
  padding?: number
  borderStyle?: 'single' | 'double' | 'round' | 'bold'
}

const borderStyles: Record<string, { tl: string; tr: string; bl: string; br: string; h: string; v: string }> = {
  single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  round: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  bold: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' }
}

export class Box {
  private content: string
  private options: BoxOptions

  constructor(content: string, options: BoxOptions = {}) {
    this.content = content
    this.options = {
      padding: 1,
      borderStyle: 'round',
      ...options
    }
  }

  toString(): string {
    const padding = this.options.padding ?? 1
    const borderStyle = this.options.borderStyle ?? 'round'
    const b = borderStyles[borderStyle]

    const lines = this.content.split('\n')
    const maxLength = Math.max(...lines.map((l: string) => this.stripAnsi(l).length))

    const width = maxLength + padding * 2 + 2
    const innerWidth = maxLength + padding * 2

    // Top border
    let result = ''
    const title = this.options.title

    if (title) {
      const titlePadded = ` ${title} `
      const titleWidth = this.stripAnsi(titlePadded).length
      const leftWidth = Math.floor((width - titleWidth) / 2)
      const rightWidth = width - titleWidth - leftWidth

      result += b.tl + b.h.repeat(leftWidth - 1) + titlePadded + b.h.repeat(rightWidth - 1) + b.tr + '\n'
    } else {
      result += b.tl + b.h.repeat(width - 2) + b.tr + '\n'
    }

    // Content
    for (const line of lines) {
      const contentLength = this.stripAnsi(line).length
      const paddingRight = innerWidth - contentLength
      result += `${b.v}${' '.repeat(padding)}${line}${' '.repeat(paddingRight + padding)}${b.v}\n`
    }

    // Bottom border
    result += b.bl + b.h.repeat(width - 2) + b.br

    return result
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[\d+m/g, '')
  }
}

/**
 * Create a styled box
 */
export function box(content: string, options?: BoxOptions): Box {
  return new Box(content, options)
}
