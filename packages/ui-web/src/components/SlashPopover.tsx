import { Component, For, Show } from "solid-js";
import { Icon } from "./Icon";
import type { SlashCommand } from "../hooks/useSlashCommands";

interface SlashPopoverProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onHover?: (index: number) => void;
}

export const SlashPopover: Component<SlashPopoverProps> = (props) => {
  return (
    <div class="absolute left-0 right-0 bottom-full mb-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-card shadow-xl z-50 py-1.5">
      <Show
        when={props.commands.length > 0}
        fallback={
          <div class="px-3 py-6 text-center text-sm text-muted-foreground">未找到匹配的命令</div>
        }
      >
        <For each={props.commands}>
          {(cmd, index) => (
            <button
              type="button"
              onClick={() => props.onSelect(cmd)}
              class={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors hover:bg-muted ${
                index() === props.selectedIndex ? "bg-muted" : ""
              }`}
              onMouseEnter={() => props.onHover?.(index())}
            >
              <Icon name={cmd.icon} size="normal" class="text-muted-foreground shrink-0" />
              <span class="flex-1 min-w-0">
                <span class="block truncate text-foreground">
                  <span class="text-muted-foreground">/</span>
                  {cmd.trigger}
                </span>
                {cmd.description && (
                  <span class="block text-xs text-muted-foreground truncate">{cmd.description}</span>
                )}
              </span>
              <span
                class={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider ${
                  cmd.source === "agent"
                    ? "bg-info/10 text-info"
                    : cmd.source === "skill"
                      ? "bg-success/10 text-success"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {cmd.source}
              </span>
            </button>
          )}
        </For>
      </Show>
    </div>
  );
};

export default SlashPopover;
