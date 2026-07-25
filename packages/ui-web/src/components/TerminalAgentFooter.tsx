import { Component, Show, createSignal, onMount, onCleanup } from "solid-js";
import { Icon } from "./Icon";
import { isAcpConnected, onAcpConnectionChange } from "../services/acp";

export type AgentStatus = "idle" | "running" | "error";
export type TerminalMode = "block" | "raw";

interface TerminalAgentFooterProps {
  status: AgentStatus;
  cwd?: string;
  gitBranch?: string;
  mode?: TerminalMode;
  activeAgent?: string;
  keyboardHint?: string;
  onAskAgent?: () => void;
  onRunSkill?: (skillId: string) => void;
}

const quickSkills = [
  { id: "bash", label: "bash", icon: "terminal" as const },
  { id: "glob", label: "glob", icon: "search" as const },
  { id: "grep", label: "grep", icon: "search" as const },
];

export const TerminalAgentFooter: Component<TerminalAgentFooterProps> = (props) => {
  const [connected, setConnected] = createSignal(isAcpConnected());

  onMount(() => {
    const unsubscribe = onAcpConnectionChange((next) => setConnected(next));
    onCleanup(unsubscribe);
  });

  const statusColor = () =>
    props.status === "running" ? "bg-warning animate-pulse" : props.status === "error" ? "bg-destructive" : "bg-success";
  const statusLabel = () =>
    props.status === "running" ? "Running" : props.status === "error" ? "Error" : "Ready";

  return (
    <div class="min-h-9 border-t border-border flex items-center justify-between px-3 py-1.5 bg-card shrink-0 gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <div
          class="flex items-center gap-1.5 shrink-0"
          title={connected() ? "Connected to ACP" : "ACP disconnected"}
        >
          <span class={`w-2 h-2 rounded-full ${connected() ? "bg-success" : "bg-destructive animate-pulse"}`} />
          <span class="text-xs text-muted-foreground">{connected() ? "Connected" : "Offline"}</span>
        </div>

        <Show when={props.mode}>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/10 text-accent uppercase tracking-wider">
            {props.mode}
          </span>
        </Show>

        <div class="flex items-center gap-1.5 shrink-0">
          <span class={`w-2 h-2 rounded-full ${statusColor()}`} />
          <span class="text-xs text-muted-foreground capitalize">{statusLabel()}</span>
        </div>

        <Show when={props.activeAgent}>
          <div class="flex items-center gap-1 text-xs text-muted-foreground truncate">
            <Icon name="subagent" size="small" />
            <span class="truncate max-w-[100px]">{props.activeAgent}</span>
          </div>
        </Show>

        <Show when={props.keyboardHint}>
          <span class="text-[10px] text-muted-foreground hidden sm:inline">{props.keyboardHint}</span>
        </Show>
      </div>

      <div class="flex items-center gap-3">
        <Show when={props.cwd}>
          <div class="flex items-center gap-1 text-xs text-muted-foreground">
            <Icon name="folder" size="small" />
            <span class="truncate max-w-[120px]">{props.cwd}</span>
          </div>
        </Show>

        <Show when={props.gitBranch}>
          <div class="flex items-center gap-1 text-xs text-muted-foreground">
            <Icon name="branch" size="small" />
            <span class="truncate max-w-[100px]">{props.gitBranch}</span>
          </div>
        </Show>

        <div class="flex items-center gap-1">
          <span class="text-[10px] text-muted-foreground uppercase tracking-wider hidden sm:inline">Skills</span>
          {quickSkills.map((skill) => (
            <button
              onClick={() => props.onRunSkill?.(skill.id)}
              class="px-2 py-0.5 rounded text-[10px] bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
              title={`Run ${skill.label}`}
            >
              {skill.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => props.onAskAgent?.()}
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          title="让 OpenStar Agent 协助"
        >
          <Icon name="subagent" size="small" />
          <span>Ask Agent</span>
        </button>
      </div>
    </div>
  );
};
