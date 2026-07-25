import { Component, createSignal, Show } from "solid-js";
import { Icon } from "./Icon";

export interface ResultCardData {
  name: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

interface Props {
  data: ResultCardData;
}

function formatDuration(ms?: number) {
  if (ms === undefined || ms === null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const ResultCard: Component<Props> = (props) => {
  const [expanded, setExpanded] = createSignal(true);

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

        <span class="text-sm font-medium text-foreground truncate">
          {props.data.name}
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
        <div class="px-3 py-2 border-t border-border text-sm">
          <Show
            when={props.data.success}
            fallback={
              <div class="text-destructive font-medium">
                {props.data.error || "执行失败"}
              </div>
            }
          >
            <Show
              when={typeof props.data.output === "string"}
              fallback={
                <pre class="overflow-auto max-h-96 p-2 rounded bg-muted text-muted-foreground text-xs">
                  <code>{JSON.stringify(props.data.output, null, 2)}</code>
                </pre>
              }
            >
              <div class="text-foreground whitespace-pre-wrap">{props.data.output as string}</div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default ResultCard;
