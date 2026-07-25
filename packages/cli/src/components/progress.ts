/**
 * Progress Spinner Component
 * Beautiful animated spinner for CLI
 */

// ANSI color codes
function cyan(msg: string): string { return `\x1b[36m${msg}\x1b[0m` }
function green(msg: string): string { return `\x1b[32m${msg}\x1b[0m` }
function red(msg: string): string { return `\x1b[31m${msg}\x1b[0m` }
function yellow(msg: string): string { return `\x1b[33m${msg}\x1b[0m` }

export class ProgressSpinner {
  private text: string
  private interval: ReturnType<typeof setInterval> | null = null
  private currentFrame: number = 0
  private started: boolean = false

  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

  constructor(text: string = 'Loading...') {
    this.text = text
  }

  start(): void {
    if (this.started) return
    this.started = true

    process.stdout.write(`\r${cyan(this.frames[0])} ${this.text}`)

    this.interval = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length
      process.stdout.write(`\r${cyan(this.frames[this.currentFrame])} ${this.text}`)
    }, 80)
  }

  setText(text: string): void {
    this.text = text
    process.stdout.write(`\r${cyan(this.frames[this.currentFrame])} ${this.text}`)
  }

  stop(message?: string): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }

    // Clear line and write final message
    process.stdout.write('\r' + ' '.repeat(50) + '\r')
    if (message) {
      process.stdout.write(message + '\n')
    }
  }

  success(message: string): void {
    this.stop(`${green('✓')} ${message}`)
  }

  error(message: string): void {
    this.stop(`${red('✗')} ${message}`)
  }

  warning(message: string): void {
    this.stop(`${yellow('⚠')} ${message}`)
  }
}

/**
 * Progress Bar Component
 */
export class ProgressBar {
  private total: number
  private current: number = 0
  private text: string
  private width: number = 40

  constructor(total: number, text: string = 'Progress') {
    this.total = total
    this.text = text
  }

  increment(amount: number = 1): void {
    this.current = Math.min(this.current + amount, this.total)
    this.render()
  }

  setProgress(current: number): void {
    this.current = Math.min(current, this.total)
    this.render()
  }

  private render(): void {
    const percentage = this.total > 0 ? Math.round((this.current / this.total) * 100) : 0
    const filled = Math.round((this.current / this.total) * this.width)
    const empty = this.width - filled

    const bar = `${cyan('█').repeat(filled)}${'░'.repeat(empty)}`
    const percent = `${percentage}%`

    process.stdout.write(`\r${this.text}: |${bar}| ${percent} (${this.current}/${this.total})`)
  }

  stop(message?: string): void {
    process.stdout.write('\n')
    if (message) {
      console.log(message)
    }
  }
}
