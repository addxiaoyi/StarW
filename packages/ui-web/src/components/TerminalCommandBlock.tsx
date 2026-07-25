import { Component, createSignal, Show, type JSX } from "solid-js";
import { Icon } from "./Icon";
import { useAppStore } from "../store/app";

export interface TerminalBlock {
  id: string;
  command: string;
  output: string;
  success: boolean;
  durationMs: number;
  createdAt: number;
  groupId?: string;
  bookmarked?: boolean;
}

interface TerminalCommandBlockProps {
  block: TerminalBlock;
  isGroupStart?: boolean;
  groupLabel?: string;
  onRerun?: (command: string) => void;
  onBookmark?: (id: string, bookmarked: boolean) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const SUBCOMMAND_TOOLS = new Set([
  "git",
  "npm",
  "yarn",
  "pnpm",
  "docker",
  "kubectl",
  "cargo",
  "go",
  "python",
  "pip",
  "brew",
  "npx",
]);

const CommandHighlighter: Component<{ command: string }> = (props) => {
  const highlighted = () => {
    const tokens = props.command.match(/(?:[^\s"']+|["'][^"']*["'])+/g) ?? [props.command];
    const elements: JSX.Element[] = [];
    tokens.forEach((token, i) => {
      let className = "text-foreground/90";
      if (i === 0) {
        className = "text-accent font-semibold";
      } else if (i === 1 && SUBCOMMAND_TOOLS.has(tokens[0])) {
        className = "text-info font-medium";
      } else if (token.startsWith("-")) {
        className = "text-warning font-medium";
      } else if (/^["']/.test(token)) {
        className = "text-success";
      }
      elements.push(<span class={className}>{token}</span>);
      if (i < tokens.length - 1) {
        elements.push(<span> </span>);
      }
    });
    return elements;
  };
  return <>{highlighted()}</>;
};

export const TerminalCommandBlock: Component<TerminalCommandBlockProps> = (props) => {
  const { toast } = useAppStore();
  const [expanded, setExpanded] = createSignal(true);
  const [copiedCommand, setCopiedCommand] = createSignal(false);
  const [copiedOutput, setCopiedOutput] = createSignal(false);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(props.block.command);
      setCopiedCommand(true);
      toast.success("命令已复制", props.block.command);
      setTimeout(() => setCopiedCommand(false), 1200);
    } catch {
      toast.error("复制失败", "无法访问剪贴板");
    }
  };

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(props.block.output);
      setCopiedOutput(true);
      toast.success("输出已复制");
      setTimeout(() => setCopiedOutput(false), 1200);
    } catch {
      toast.error("复制失败", "无法访问剪贴板");
    }
  };

  const handleRerun = () => props.onRerun?.(props.block.command);
  const toggleBookmark = () => props.onBookmark?.(props.block.id, !props.block.bookmarked);

  const statusBg = () => (props.block.success ? "bg-success" : "bg-destructive");
  const statusIcon = () => (props.block.success ? "circle-check" : "circle-x");

  return (
    <div class="mb-2 oc-animate-fade-in">
      <Show when={props.isGroupStart && props.groupLabel}>
        <div class="flex items-center gap-2 mb-2 mt-3">
          <div class="h-px flex-1 bg-border/40" />
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">{props.groupLabel}</span>
          <div class="h-px flex-1 bg-border/40" />
        </div>
      </Show>

      <div class="rounded-lg border border-border bg-card overflow-hidden group/block">
        <div class="flex items-start gap-2 px-3 py-2.5 hover:bg-[var(--oc-surface-hover)] transition-colors">
          <div class="flex items-center gap-2 pt-0.5 shrink-0">
            <span class={`w-2 h-2 rounded-full ${statusBg()}`} />
          </div>

          <button onClick={() => setExpanded((v) => !v)} class="flex-1 min-w-0 text-left">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-mono truncate">
                <span class="text-accent mr-1">$</span>
                <CommandHighlighter command={props.block.command} />
              </span>
            </div>
            <div class="flex items-center gap-3 mt-1">
              <span class="text-[10px] text-muted-foreground tabular-nums">{formatTime(props.block.createdAt)}</span>
              <span class="text-[10px] text-muted-foreground tabular-nums">{formatDuration(props.block.durationMs)}</span>
              <span class={`text-[10px] tabular-nums ${props.block.success ? "text-success" : "text-destructive"}`}>
                <Icon name={statusIcon()} size="small" />
              </span>
              <Show when={props.block.bookmarked}>
                <span class="text-warning">
                  <Icon name="star-filled" size="small" />
                </span>
              </Show>
            </div>
          </button>

          <div class="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/block:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              class="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[var(--oc-surface-active)] text-muted-foreground hover:text-foreground transition-colors"
              onClick={copyCommand}
              title="复制命令"
            >
              <Icon name={copiedCommand() ? "check-small" : "copy"} size="small" />
            </button>
            <Show when={props.block.output}>
              <button
                class="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[var(--oc-surface-active)] text-muted-foreground hover:text-foreground transition-colors"
                onClick={copyOutput}
                title="复制输出"
              >
                <Icon name={copiedOutput() ? "check-small" : "copy"} size="small" />
              </button>
            </Show>
            <button
              class="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[var(--oc-surface-active)] text-muted-foreground hover:text-foreground transition-colors"
              onClick={handleRerun}
              title="重新运行"
            >
              <Icon name="play" size="small" />
            </button>
            <button
              class={`w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[var(--oc-surface-active)] transition-colors ${props.block.bookmarked ? "text-warning" : "text-muted-foreground hover:text-foreground"}`}
              onClick={toggleBookmark}
              title={props.block.bookmarked ? "Remove bookmark" : "Bookmark"}
            >
              <Icon name={props.block.bookmarked ? "star-filled" : "star"} size="small" />
            </button>
            <button
              class="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[var(--oc-surface-active)] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExpanded((v) => !v)}
              title={expanded() ? "Collapse" : "Expand"}
            >
              <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
            </button>
          </div>
        </div>

        <Show when={expanded()}>
          <div class="border-t border-border bg-background">
            <Show
              when={props.block.output}
              fallback={<div class="px-3 py-2 text-xs text-muted-foreground italic">No output</div>}
            >
              <pre class="m-0 px-3 py-2.5 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all text-foreground overflow-x-auto">
                {props.block.output}
              </pre>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};
