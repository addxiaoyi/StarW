import { Component, For, Show } from "solid-js";
import { useAppStore } from "../store/app";
import { Icon } from "./Icon";

const typeStyles = {
  success: {
    icon: "circle-check" as const,
    border: "border-success/30",
    bg: "bg-success-muted",
    text: "text-success",
  },
  error: {
    icon: "warning" as const,
    border: "border-destructive/30",
    bg: "bg-destructive/10",
    text: "text-destructive",
  },
  info: {
    icon: "help" as const,
    border: "border-info/30",
    bg: "bg-info-muted",
    text: "text-info",
  },
  warning: {
    icon: "warning" as const,
    border: "border-warning/30",
    bg: "bg-warning-muted",
    text: "text-warning",
  },
};

export const ToastContainer: Component = () => {
  const { toasts, removeToast } = useAppStore();

  return (
    <div class="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
      <For each={toasts()}>
        {(item) => {
          const style = typeStyles[item.type];
          return (
            <div
              role="status"
              class={`pointer-events-auto flex items-start gap-3 p-3 rounded-xl border shadow-lg backdrop-blur-sm oc-animate-fade-in ${style.border} ${style.bg} bg-card/95`}
            >
              <div class={`mt-0.5 ${style.text}`}>
                <Icon name={style.icon} size="normal" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-foreground">{item.title}</div>
                <Show when={item.message}>
                  <div class="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.message}</div>
                </Show>
              </div>
              <button
                type="button"
                onClick={() => removeToast(item.id)}
                class="oc-icon-button w-6 h-6 shrink-0"
                title="关闭"
              >
                <Icon name="close-small" size="small" />
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
};
