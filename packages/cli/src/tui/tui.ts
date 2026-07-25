/**
 * OpenStar TUI Engine
 * A self-contained full-screen terminal UI (no external TUI dependencies).
 * Features: full-screen rendering, scrollback, command history (↑/↓),
 * tab completion, block cursor, live status bar, Ctrl+L clear, Ctrl+C exit.
 *
 * Works on any ANSI terminal. Falls back to a plain line REPL when stdin
 * is not a TTY (e.g. piped / CI).
 */
import { getTheme, type Theme } from "./theme.js";
import { renderMarkdown } from "./markdown.js";

export interface TuiCommandContext {
  theme: Theme;
  /** Append one or more lines (splits on \n). Supports ANSI. */
  print: (line: string) => void;
  /** Clear the scrollback buffer. */
  clearScreen: () => void;
  /** Update the bottom status bar text. */
  setStatus: (status: string) => void;
  /** Switch the active theme at runtime. */
  setTheme: (name: string) => void;
  /** Terminate the TUI. */
  exit: () => void;
}

export type TuiCommandHandler = (
  command: string,
  ctx: TuiCommandContext,
) => Promise<void> | void;

export interface TuiOptions {
  title?: string;
  version?: string;
  theme?: string;
  /** Slash-command hints for tab completion. */
  commands?: string[];
  /** Called for each submitted command. */
  onCommand?: TuiCommandHandler;
}

const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_SCREEN = `${ESC}[2J`;
const MOVE_HOME = `${ESC}[H`;

export class Tui {
  private theme: Theme;
  private title: string;
  private version: string;
  private opts: TuiOptions;

  private lines: string[] = [];
  private input = "";
  private cursor = 0;
  private history: string[] = [];
  private historyIdx = -1;
  private status = "ready";
  private busy = false;
  private running = false;

  constructor(opts: TuiOptions = {}) {
    this.opts = opts;
    this.theme = getTheme(opts.theme);
    this.title = opts.title ?? "OpenStar";
    this.version = opts.version ?? "0.1.0";
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Print a line (or multiple) to the scrollback. */
  print(line: string): void {
    for (const raw of line.split("\n")) {
      // Keep pre-styled (ANSI) lines intact; render Markdown for plain text.
      this.lines.push(raw.startsWith("\x1b") ? raw : renderMarkdown(raw));
    }
  }

  setStatus(status: string): void {
    this.status = status;
  }

  /** Switch theme at runtime. */
  setTheme(name: string): void {
    const t = getTheme(name);
    this.theme = t;
    this.render();
  }

  clearScreen(): void {
    this.lines = [];
  }

  /** Start the TUI. Returns a promise that resolves on exit. */
  async start(): Promise<void> {
    if (!process.stdin.isTTY) {
      await this.runFallback();
      return;
    }
    this.running = true;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(HIDE_CURSOR);
    this.render();

    process.stdin.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    process.stdout.on("resize", () => this.render());
  }

  stop(): void {
    this.running = false;
    process.stdout.write(SHOW_CURSOR);
    process.stdout.write("\n");
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
    process.stdin.pause();
  }

  // ── Input handling ──────────────────────────────────────────────────

  private onData(s: string): void {
    if (!this.running) return;

    if (s === "\x03") {
      // Ctrl+C
      this.print(this.theme.warn("^C — use /exit to quit"));
      this.render();
      return;
    }
    if (s === "\x0c") {
      // Ctrl+L clear screen
      this.lines = [];
      this.render();
      return;
    }
    if (s === "\x10") {
      // Ctrl+P -> command palette (list commands)
      this.print(this.theme.dim("Commands: " + (this.opts.commands ?? []).join("  ")));
      this.render();
      return;
    }
    if (s === "\r" || s === "\n") {
      this.submit();
      return;
    }
    if (s === "\x7f" || s === "\b") {
      this.backspace();
      return;
    }
    if (s === "\x1b[A") return this.historyPrev();
    if (s === "\x1b[B") return this.historyNext();
    if (s === "\x1b[C") return this.moveCursor(1);
    if (s === "\x1b[D") return this.moveCursor(-1);
    if (s === "\x1b[H" || s === "\x01") return this.moveCursor(-this.input.length);
    if (s === "\x1b[F" || s === "\x05") return this.moveCursor(this.input.length);
    if (s === "\t") return this.complete();
    if (s.startsWith("\x1b")) return; // other escape sequences ignored

    // Printable text (may be multi-char paste)
    let inserted = "";
    for (const ch of s) {
      const code = ch.codePointAt(0)!;
      if (code < 32 || code === 127) continue;
      inserted += ch;
    }
    if (inserted) {
      this.input = this.input.slice(0, this.cursor) + inserted + this.input.slice(this.cursor);
      this.cursor += inserted.length;
      this.render();
    }
  }

  private backspace(): void {
    if (this.cursor > 0) {
      this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
      this.cursor--;
      this.render();
    }
  }

  private moveCursor(delta: number): void {
    const next = Math.max(0, Math.min(this.input.length, this.cursor + delta));
    if (next !== this.cursor) {
      this.cursor = next;
      this.render();
    }
  }

  private historyPrev(): void {
    if (this.history.length === 0) return;
    if (this.historyIdx === -1) this.historyIdx = this.history.length - 1;
    else if (this.historyIdx > 0) this.historyIdx--;
    this.input = this.history[this.historyIdx] ?? "";
    this.cursor = this.input.length;
    this.render();
  }

  private historyNext(): void {
    if (this.historyIdx === -1) return;
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      this.input = this.history[this.historyIdx];
    } else {
      this.historyIdx = -1;
      this.input = "";
    }
    this.cursor = this.input.length;
    this.render();
  }

  private complete(): void {
    if (!this.input.startsWith("/")) return;
    const hints = this.opts.commands ?? [];
    const matches = hints.filter((c) => c.startsWith(this.input) && c !== this.input);
    if (matches.length === 1) {
      this.input = matches[0];
      this.cursor = this.input.length;
      this.render();
    } else if (matches.length > 1) {
      this.print(this.theme.dim(matches.join("   ")));
      this.render();
    }
  }

  private async submit(): Promise<void> {
    const cmd = this.input;
    this.input = "";
    this.cursor = 0;
    this.historyIdx = -1;

    if (cmd.trim()) {
      if (this.history[this.history.length - 1] !== cmd) this.history.push(cmd);
      this.print(`${this.theme.primary("◆")} ${this.theme.dim(cmd)}`);
    }
    this.render();

    if (this.busy) {
      this.print(this.theme.warn("Busy — please wait for the current command."));
      this.render();
      return;
    }
    if (!cmd.trim()) return;

    this.busy = true;
    this.setStatus("running…");
    this.render();

    try {
      await this.opts.onCommand?.(cmd, this.commandContext());
    } catch (err) {
      this.print(this.theme.error(`Error: ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      this.busy = false;
      this.setStatus("ready");
      this.render();
    }
  }

  private commandContext(): TuiCommandContext {
    return {
      theme: this.theme,
      print: (l) => this.print(l),
      clearScreen: () => this.clearScreen(),
      setStatus: (s) => this.setStatus(s),
      setTheme: (n) => this.setTheme(n),
      exit: () => {
        this.stop();
        process.exit(0);
      },
    };
  }

  // ── Rendering ───────────────────────────────────────────────────────

  private render(): void {
    if (!process.stdout.isTTY) return;
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    const headerRows = 1;
    const statusRows = 1;
    const inputRows = 1;
    const contentRows = Math.max(1, rows - headerRows - statusRows - inputRows);

    // Build physical (wrapped) lines from logical content
    const wrapped = this.wrap(this.lines, cols);
    const visible = wrapped.slice(-contentRows);
    // pad to contentRows
    while (visible.length < contentRows) visible.unshift("");

    let out = CLEAR_SCREEN + MOVE_HOME;

    // Header
    out += this.theme.primary(`╭─ ${this.title} `);
    const headerRight = ` v${this.version} `;
    const headerPad = Math.max(0, cols - this.title.length - headerRight.length - 4);
    out += "─".repeat(headerPad) + this.theme.secondary(headerRight) + this.theme.primary("╮");
    out += "\n";

    for (const l of visible) {
      out += `│ ${this.pad(l, cols - 2)}\n`;
    }

    // Status bar
    const stColor =
      this.status === "ready"
        ? this.theme.success
        : this.status === "running…"
          ? this.theme.warn
          : this.theme.dim;
    out += this.theme.primary("├─");
    const statusText = ` ${stColor(this.status)} ${this.theme.dim(`· ${this.lines.length} lines`)} `;
    const statusPad = Math.max(0, cols - statusText.length - 3);
    out += statusText + this.theme.primary("─".repeat(statusPad) + "┤");
    out += "\n";

    // Input line
    const inputDisplay = this.renderInput();
    out += this.theme.primary("╰─ ") + this.pad(inputDisplay, cols - 4) + "\n";

    process.stdout.write(out);
  }

  private renderInput(): string {
    const prompt = this.theme.primary("◆") + " ";
    const before = this.input.slice(0, this.cursor);
    const at = this.input[this.cursor] ?? " ";
    const after = this.input.slice(this.cursor + 1);
    // Block cursor: invert the char at cursor position
    const cursorChar = `${ESC}[7m${at}${ESC}[0m`;
    return prompt + before + cursorChar + after;
  }

  private wrap(lines: string[], cols: number): string[] {
    const inner = Math.max(10, cols - 2); // account for "│ "
    const result: string[] = [];
    for (const line of lines) {
      const stripped = stripAnsi(line);
      if (stripped.length <= inner) {
        result.push(line);
        continue;
      }
      // wrap by visible width
      let cur = "";
      let curWidth = 0;
      for (const ch of line) {
        const w = charWidth(ch);
        if (curWidth + w > inner) {
          result.push(cur);
          cur = "";
          curWidth = 0;
        }
        cur += ch;
        curWidth += w;
      }
      if (cur) result.push(cur);
    }
    return result;
  }

  private pad(s: string, width: number): string {
    const w = stripAnsi(s).length;
    if (w >= width) return s.slice(0, width);
    return s + " ".repeat(width - w);
  }

  // ── Fallback (non-TTY) ──────────────────────────────────────────────

  private async runFallback(): Promise<void> {
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.print = (l) => {
      for (const x of l.split("\n")) console.log(x);
    };
    this.render = () => {};
    const ctx = this.commandContext();
    console.log(this.theme.primary(`◆ ${this.title} v${this.version} (line mode)`));
    rl.setPrompt(this.theme.primary("◆ ") + " ");
    rl.prompt();
    rl.on("line", async (line) => {
      if (line.trim()) {
        try {
          await this.opts.onCommand?.(line, ctx);
        } catch (err) {
          console.log(this.theme.error(`Error: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
      rl.prompt();
    });
    rl.on("close", () => this.stop());
  }
}

// ── ANSI helpers ──────────────────────────────────────────────────────

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

function charWidth(ch: string): number {
  const code = ch.codePointAt(0)!;
  // CJK ranges => width 2
  if (code >= 0x1100 && code <= 0x115f) return 2;
  if (code >= 0x2e80 && code <= 0x303e) return 2;
  if (code >= 0x3041 && code <= 0x33ff) return 2;
  if (code >= 0x3400 && code <= 0x4dbf) return 2;
  if (code >= 0x4e00 && code <= 0x9fff) return 2;
  if (code >= 0xa000 && code <= 0xa4cf) return 2;
  if (code >= 0xac00 && code <= 0xd7a3) return 2;
  if (code >= 0xf900 && code <= 0xfaff) return 2;
  if (code >= 0xfe30 && code <= 0xfe4f) return 2;
  if (code >= 0xff00 && code <= 0xff60) return 2;
  if (code >= 0xffe0 && code <= 0xffe6) return 2;
  return 1;
}
