import { Component, For, createSignal } from "solid-js";
import { useAppStore } from "../store/app";
import { Icon } from "./Icon";
import type { Session } from "../types";

const TabStrip: Component = () => {
  const { state, sessions, selectSession, deleteSession, createSession } = useAppStore();

  const [hoveredId, setHoveredId] = createSignal<string | null>(null);

  const handleClose = (e: MouseEvent, session: Session) => {
    e.stopPropagation();
    if (session.messages.length > 0) {
      const confirmed = window.confirm(`关闭会话 “${session.title}” 将丢失其中的消息。是否继续？`);
      if (!confirmed) return;
    }
    deleteSession(session.id);
  };

  return (
    <div class="flex items-center h-10 bg-background border-b border-border overflow-hidden shrink-0">
      <div class="flex-1 flex items-center h-full overflow-x-auto oc-scrollbar-hidden">
        <For each={sessions()}>
          {(session) => {
            const active = () => state().activeSessionId === session.id;
            const hovered = () => hoveredId() === session.id;
            const showClose = () => active() || hovered();

            return (
              <button
                onClick={() => selectSession(session.id)}
                onMouseEnter={() => setHoveredId(session.id)}
                onMouseLeave={() => setHoveredId((prev) => (prev === session.id ? null : prev))}
                class={[
                  "group relative flex items-center h-full min-w-[7.5rem] max-w-[12rem] px-3 text-sm select-none cursor-pointer transition-all duration-150 border-r border-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--oc-ring)]",
                  active()
                    ? "bg-card text-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-card/50 hover:text-foreground",
                ].join(" ")}
              >
                {active() && (
                  <span class="absolute top-0 left-0 right-0 h-[2px] bg-primary" />
                )}
                <span class="truncate flex-1 text-left">{session.title}</span>
                <span
                  onClick={(e) => handleClose(e, session)}
                  class={[
                    "ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-ring)]",
                    showClose() ? "opacity-100" : "opacity-0",
                    "text-muted-foreground hover:text-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  <Icon name="close-small" size="small" />
                </span>
              </button>
            );
          }}
        </For>
      </div>

      <button
        onClick={createSession}
        class="inline-flex items-center justify-center w-9 h-full shrink-0 text-muted-foreground hover:text-foreground hover:bg-card transition-all duration-150 border-l border-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--oc-ring)]"
        title="新建会话"
      >
        <Icon name="plus-small" size="normal" />
      </button>
    </div>
  );
};

export default TabStrip;
