import { Component, createSignal, Show } from "solid-js";
import { Icon } from "./Icon";

export interface ToolCallData {
  tool: string;
  arguments?: Record<string, unknown>;
  success: boolean;
  resultSummary: string;
  durationMs?: number;
  timestamp?: number;
}

interface Props {
  data: ToolCallData;
}

function formatDuration(ms?: number) {
  if (ms === undefined || ms === null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function stringifyTruncated(value: unknown, maxLength = 800): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} chars]`;
}

const ToolCallBlock: Component<Props> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  const toggle = () => setExpanded((prev) => !prev);

  return (
    <div class="rounded-lg border border-border bg-card overflow-hidden my-2">
      <button
        type="button"
        onClick={toggle}
        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/5 transition-colors"
      >
        <Show
          when={props.data.success}
          fallback={<Icon name="circle-x" class="text-destructive shrink-0" size="small" />}
        >
          <Icon name="circle-check" class="text-success shrink-0" size="small" />
        </Show>

        <Icon name="terminal" class="text-muted-foreground shrink-0" size="small" />

        <span class="text-sm font-medium text-foreground truncate">
          {props.data.tool}
        </span>

        <Show when={formatDuration(props.data.durationMs)}>
          <span class="text-xs text-muted-foreground ml-auto shrink-0">
            {formatDuration(props.data.durationMs)}
          </span>
        </Show>

        <Icon
          name={expanded() ? "chevron-down" : "chevron-right"}
          class="text-muted-foreground shrink-0"
          size="small"
        />
      </button>

      <Show when={expanded()}>
        <div class="px-3 py-2 border-t border-border text-sm space-y-2">
          <div>
            <div class="text-xs text-muted-foreground mb-1">参数</div>
            <pre class="overflow-auto max-h-40 p-2 rounded bg-muted text-muted-foreground text-xs">
              <code>{stringifyTruncated(props.data.arguments, 600)}</code>
            </pre>
          </div>

          <div>
            <div class="text-xs text-muted-foreground mb-1">结果</div>
            <Show
              when={props.data.success}
              fallback={
                <div class="text-destructive font-medium">
                  {props.data.resultSummary || "执行失败"}
                </div>
              }
            >
              <pre class="overflow-auto max-h-64 p-2 rounded bg-muted text-muted-foreground text-xs">
                <code>{props.data.resultSummary}</code>
              </pre>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default ToolCallBlock;
