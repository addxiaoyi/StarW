/**
 * Interactive PTY terminal backed by Electron node-pty and rendered by xterm.
 */
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { Icon } from "../Icon";
import type { CommandBlock } from "../../workbench/types";
import { subscribeDesktopEvent } from "../../services/desktop";
import {
  createInteractiveTerminal,
  disposeInteractiveTerminal,
  resizeInteractiveTerminal,
  writeInteractiveTerminal,
  type InteractiveTerminalSession,
} from "../../services/terminal";

interface TerminalPaneProps {
  sessionId: string;
  sessionTitle: string;
  cwd: string;
  branch: string;
  blocks: CommandBlock[];
  active: boolean;
  commandRunning: boolean;
  onRun: (command: string) => Promise<void>;
  onCancel: () => void | Promise<void>;
  onClear: () => void;
}

type TerminalPhase = "starting" | "ready" | "exited" | "error";

function recordPayload(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const CommandBlockView: Component<{
  block: CommandBlock;
  onRepeat: (command: string) => void;
}> = (props) => (
  <article
    class="sc-command-block"
    classList={{ [`is-${props.block.status}`]: true }}
  >
    <header class="sc-command-head">
      <span class="sc-command-prompt">❯</span>
      <code>{props.block.command}</code>
      <div class="sc-command-actions">
        <span class="sc-command-status">{props.block.status}</span>
        <button
          type="button"
          class="sc-icon-button"
          aria-label="重新运行"
          onClick={() => props.onRepeat(props.block.command)}
        >
          <Icon name="play" size="small" />
        </button>
      </div>
    </header>
    <Show when={props.block.output}>
      <pre class="sc-command-output">{props.block.output}</pre>
    </Show>
  </article>
);

const TerminalPane: Component<TerminalPaneProps> = (props) => {
  const isActive = createMemo(() => props.active);
  const [phase, setPhase] = createSignal<TerminalPhase>("starting");
  const [error, setError] = createSignal("");
  let host!: HTMLDivElement;
  let terminal: Terminal | undefined;
  let fitAddon: FitAddon | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let attached: InteractiveTerminalSession | undefined;
  let mounted = false;
  let started = false;
  let targetKey = "";
  let generation = 0;
  let unsubscribeTheme = () => {};
  const pendingOutput = new Map<string, string[]>();
  const pendingExit = new Map<string, Record<string, unknown>>();

  const terminalTheme = () => {
    const style = getComputedStyle(document.documentElement);
    return {
      background: style.getPropertyValue("--bg").trim() || "#11110f",
      foreground: style.getPropertyValue("--text").trim() || "#e8e7df",
      cursor: style.getPropertyValue("--text-2").trim() || "#d8d7cf",
      selectionBackground: style.getPropertyValue("--bg-4").trim() || "#3a3933",
    };
  };

  const fit = () => {
    if (!mounted || !isActive() || !terminal || !fitAddon) return;
    if (host.clientWidth < 20 || host.clientHeight < 20) return;
    fitAddon.fit();
    terminal.focus();
  };

  const showExit = (payload: Record<string, unknown>) => {
    const code =
      typeof payload.exitCode === "number" ? payload.exitCode : "unknown";
    setPhase(code === 0 ? "exited" : "error");
    terminal?.write(
      `\r\n\x1b[90m[OpenStar PTY exited: ${String(code)}]\x1b[0m\r\n`,
    );
  };

  const unsubscribe = subscribeDesktopEvent((event, payload) => {
    if (event !== "terminal.output" && event !== "terminal.exit") return;
    const record = recordPayload(payload);
    if (!record || record.sessionId !== props.sessionId) return;
    const instanceId =
      typeof record.instanceId === "string" ? record.instanceId : "";
    if (!instanceId) return;

    if (!attached) {
      if (event === "terminal.output") {
        const data = typeof record.data === "string" ? record.data : "";
        if (data) {
          const buffered = pendingOutput.get(instanceId) ?? [];
          buffered.push(data);
          pendingOutput.set(instanceId, buffered);
        }
      } else {
        pendingExit.set(instanceId, record);
      }
      return;
    }
    if (instanceId !== attached.instanceId) return;
    if (event === "terminal.output") {
      const data = typeof record.data === "string" ? record.data : "";
      if (data) terminal?.write(data);
    } else {
      attached = undefined;
      showExit(record);
    }
  });

  const disposeAttached = async () => {
    const current = attached;
    attached = undefined;
    if (!current) return;
    try {
      await disposeInteractiveTerminal(current.sessionId, current.instanceId);
    } catch {
      // Renderer shutdown and process exit can race.
    }
  };

  const start = async () => {
    if (!mounted || !terminal || !fitAddon) return;
    started = true;
    const currentGeneration = ++generation;
    await disposeAttached();
    pendingOutput.clear();
    pendingExit.clear();
    terminal.reset();
    setPhase("starting");
    setError("");
    terminal.write("\x1b[90mStarting OpenStar PTY...\x1b[0m\r\n");
    if (isActive()) requestAnimationFrame(fit);

    try {
      const session = await createInteractiveTerminal(
        props.sessionId,
        props.cwd,
        Math.max(terminal.cols, 80),
        Math.max(terminal.rows, 24),
      );
      if (!mounted || currentGeneration !== generation) {
        await disposeInteractiveTerminal(session.sessionId, session.instanceId);
        return;
      }
      attached = session;
      setPhase("ready");
      for (const data of pendingOutput.get(session.instanceId) ?? []) {
        terminal.write(data);
      }
      pendingOutput.clear();
      const exited = pendingExit.get(session.instanceId);
      pendingExit.clear();
      if (exited) {
        attached = undefined;
        showExit(exited);
      }
      if (isActive()) requestAnimationFrame(fit);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setPhase("error");
      terminal.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
    }
  };

  onMount(() => {
    mounted = true;
    targetKey = `${props.sessionId}\u0000${props.cwd}`;
    terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "Cascadia Code, Fira Code, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 10000,
      theme: terminalTheme(),
    });
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminal.onData((data) => {
      const current = attached;
      if (!current) return;
      void writeInteractiveTerminal(
        current.sessionId,
        current.instanceId,
        data,
      ).catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPhase("error");
      });
    });
    terminal.onResize(({ cols, rows }) => {
      const current = attached;
      if (!current || !isActive()) return;
      void resizeInteractiveTerminal(
        current.sessionId,
        current.instanceId,
        cols,
        rows,
      ).catch(() => {});
    });
    resizeObserver = new ResizeObserver(() => requestAnimationFrame(fit));
    resizeObserver.observe(host);
    unsubscribeTheme =
      window.starcore?.onThemeChanged(() => {
        if (terminal) terminal.options.theme = terminalTheme();
      }) ?? (() => {});
    if (isActive()) void start();
  });

  createEffect(() => {
    const nextKey = `${props.sessionId}\u0000${props.cwd}`;
    const active = isActive();
    if (!mounted) return;
    if (nextKey !== targetKey) {
      targetKey = nextKey;
      started = false;
      if (active) void start();
      else {
        generation += 1;
        void disposeAttached();
        terminal?.reset();
        setPhase("starting");
      }
      return;
    }
    if (active && !started) void start();
    else if (active) requestAnimationFrame(fit);
  });

  onCleanup(() => {
    mounted = false;
    generation += 1;
    resizeObserver?.disconnect();
    unsubscribe();
    unsubscribeTheme();
    void disposeAttached();
    terminal?.dispose();
  });

  return (
    <section
      class="oc-terminal-page sc-terminal-pane"
      classList={{ "is-hidden": !isActive() }}
      aria-label={`${props.sessionTitle} interactive terminal`}
    >
      <header class="sc-pane-toolbar">
        <div class="sc-path">
          <Icon name="folder-open" size="small" />
          <span>{props.cwd}</span>
          <Show when={props.branch}>
            <span class="sc-path-separator">/</span>
            <Icon name="branch" size="small" />
            <span title={props.branch}>{props.branch}</span>
          </Show>
        </div>
        <div class="sc-toolbar-actions">
          <span
            class={`sc-pty-state is-${phase()}`}
            role="status"
            aria-live="polite"
          >
            PTY · {phase()}
          </span>
          <Show when={props.commandRunning}>
            <button
              type="button"
              class="oc-button"
              aria-label="停止运行中的自动化命令"
              title="停止运行中的自动化命令"
              onClick={() => void props.onCancel()}
            >
              <Icon name="stop" size="small" />
              停止任务
            </button>
          </Show>
          <Show when={phase() === "error" || phase() === "exited"}>
            <button
              type="button"
              class="sc-icon-button"
              aria-label="重启终端"
              title="重启终端"
              onClick={() => void start()}
            >
              <Icon name="reset" size="small" />
            </button>
          </Show>
        </div>
      </header>

      <Show when={props.blocks.length > 0}>
        <details class="sc-terminal-notices">
          <summary>
            {props.blocks.length} automation result
            {props.blocks.length === 1 ? "" : "s"}
            <button
              type="button"
              class="sc-icon-button"
              aria-label="Clear automation results"
              onClick={(event) => {
                event.preventDefault();
                props.onClear();
              }}
            >
              <Icon name="trash" size="small" />
            </button>
          </summary>
          <div class="sc-terminal-notice-list">
            <For each={props.blocks}>
              {(block) => (
                <CommandBlockView
                  block={block}
                  onRepeat={(command) => void props.onRun(command)}
                />
              )}
            </For>
          </div>
        </details>
      </Show>

      <div class="sc-pty-shell">
        <div ref={host} class="sc-pty-host" />
        <Show when={error()}>
          <div class="sc-pty-error">{error()}</div>
        </Show>
      </div>
    </section>
  );
};

export default TerminalPane;
