/**
 * OpenStar Terminal UI Component
 * Beautiful terminal interface with auto-complete and history
 */

import * as readline from 'readline'
import { EventEmitter } from 'events'
import { bold, dim, cyan } from './colors.js'
import { Box } from './box.js'

// Helper functions for colors
function green(msg: string): string { return `\x1b[32m${msg}\x1b[0m` }
function yellow(msg: string): string { return `\x1b[33m${msg}\x1b[0m` }
function red(msg: string): string { return `\x1b[31m${msg}\x1b[0m` }
function colors(msg: string): string { return msg }

function info(message: string): string {
  return `${colors(cyan('ℹ'))} ${message}`
}

function success(message: string): string {
  return `${colors(green('✓'))} ${message}`
}

function warning(message: string): string {
  return `${colors(yellow('⚠'))} ${message}`
}

function error(message: string): string {
  return `${colors(red('✗'))} ${message}`
}

export interface TerminalOptions {
  prompt?: string
  welcome?: string
  onInput?: (input: string) => void | Promise<void>
  history?: string[]
  autoComplete?: string[]
}

export class Terminal extends EventEmitter {
  private prompt: string
  private welcome: string
  private onInput?: (input: string) => void | Promise<void>
  private history: string[]
  private autoComplete: string[]
  private rl: readline.Interface | null = null
  private historyIndex: number = -1

  constructor(options: TerminalOptions = {}) {
    super()

    this.prompt = options.prompt || `${cyan('openstar')} ${dim('>')}`
    this.welcome = options.welcome || ''
    this.onInput = options.onInput
    this.history = options.history || []
    this.autoComplete = options.autoComplete || []

    // Setup readline
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      completer: this.completer.bind(this)
    })

    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    if (!this.rl) return

    this.rl.on('line', async (line) => {
      const input = line.trim()

      if (input) {
        this.history.push(input)
        this.historyIndex = this.history.length

        if (this.onInput) {
          await this.onInput(input)
        }

        this.emit('input', input)
      }

      this.rl?.prompt()
    })

    this.rl.on('history', (history) => {
      // Merge with our history
    })

    this.rl.on('close', () => {
      this.emit('close')
    })
  }

  private completer(line: string): [string[], string] {
    const hits = this.autoComplete.filter(c => c.startsWith(line))
    return [hits.length > 0 ? hits : [], line]
  }

  async start(): Promise<void> {
    if (this.welcome) {
      console.log(this.welcome)
      console.log('')
    }

    console.log(dim('Type /help for commands, /exit to quit'))
    console.log('')

    this.rl?.prompt()
  }

  print(message: string): void {
    console.log(message)
    this.rl?.prompt()
  }

  printBox(title: string, content: string): void {
    const box = new Box(content, { title })
    console.log(box.toString())
    this.rl?.prompt()
  }

  printSuccess(message: string): void {
    this.print(success(message))
  }

  printError(message: string): void {
    this.print(error(message))
  }

  printWarning(message: string): void {
    this.print(warning(message))
  }

  printInfo(message: string): void {
    this.print(info(message))
  }

  clear(): void {
    console.clear()
    this.rl?.prompt()
  }

  setPrompt(prompt: string): void {
    this.prompt = prompt
    this.rl?.setPrompt(prompt)
  }

  close(): void {
    this.rl?.close()
    this.rl = null
  }
}

/**
 * Create a terminal instance with default OpenStar styling
 */
export function createTerminal(options: TerminalOptions = {}): Terminal {
  const defaultWelcome = `
${cyan('╔══════════════════════════════════════════════════╗')}
${cyan('║')}   ${bold('OpenStar')} ${dim('v0.1.0')}                                 ${cyan('║')}
${cyan('║')}   ${dim('Skill + MCP + Agent Swarm Platform')}          ${cyan('║')}
${cyan('╚══════════════════════════════════════════════════╝')}
`

  return new Terminal({
    prompt: options.prompt || `${cyan('◆')} `,
    welcome: options.welcome || defaultWelcome,
    ...options
  })
}
