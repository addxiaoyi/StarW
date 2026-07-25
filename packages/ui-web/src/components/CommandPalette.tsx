import { Component, For, Show, createSignal, createEffect, createResource, createMemo, onMount, onCleanup } from "solid-js";
import { useAppStore } from "../store/app";
import { useCommand, type CommandSource } from "../context/command";
import type { ViewMode } from "../types";
import { Icon, type IconName } from "./Icon";
import { listSkills, executeSkill, type AcpSkillItem } from "../services/acp";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface Action {
  id: string;
  label: string;
  description?: string;
  icon: IconName;
  shortcut?: string;
  category: string;
  slash?: string;
  onSelect?: (source?: CommandSource) => void;
}

const categoryOrder = ["视图", "技能", "命令", "代理", "设置", "会话", "界面"];

const categoryLabels: Record<string, string> = {
  views: "视图",
  skills: "技能",
  commands: "命令",
  agents: "代理",
  settings: "设置",
  session: "会话",
  appearance: "界面",
};

const mapCategory = (raw?: string): string => {
  if (!raw) return categoryLabels.commands;
  const key = raw.toLowerCase();
  if (key === "view" || key === "views" || key === "视图") return categoryLabels.views;
  if (key === "skill" || key === "skills" || key === "技能") return categoryLabels.skills;
  if (key === "command" || key === "commands" || key === "命令") return categoryLabels.commands;
  if (key === "agent" || key === "agents" || key === "代理") return categoryLabels.agents;
  if (key === "setting" || key === "settings" || key === "设置") return categoryLabels.settings;
  if (key === "session" || key === "会话") return categoryLabels.session;
  if (key === "interface" || key === "appearance" || key === "界面") return categoryLabels.appearance;
  return raw;
};

const systemActions: Action[] = [
  { id: "chat", label: "切换到对话", icon: "speech-bubble", shortcut: "Cmd+1", category: categoryLabels.views },
  { id: "terminal", label: "切换到终端", icon: "terminal", shortcut: "Cmd+2", category: categoryLabels.views },
  { id: "canvas", label: "切换到画布", icon: "photo", shortcut: "Cmd+3", category: categoryLabels.views },
  { id: "browser", label: "切换到浏览器", icon: "window-cursor", shortcut: "Cmd+4", category: categoryLabels.views },
  { id: "swarm", label: "切换到代理集群", icon: "subagent", shortcut: "Cmd+5", category: categoryLabels.views },
  { id: "templates", label: "切换到模板市场", icon: "file-tree", shortcut: "Cmd+6", category: categoryLabels.views },
  { id: "marketplace", label: "切换到 ECC 市场", icon: "server", shortcut: "Cmd+7", category: categoryLabels.views },
  { id: "files", label: "切换到文件", icon: "folder", shortcut: "Cmd+8", category: categoryLabels.views },
  { id: "settings", label: "切换到设置", icon: "settings-gear", shortcut: "Cmd+9", category: categoryLabels.settings },
  { id: "new-session", label: "新建会话", icon: "plus-small", shortcut: "Cmd+N", category: categoryLabels.session },
  { id: "toggle-theme", label: "切换主题", icon: "sun", shortcut: "Cmd+Shift+L", category: categoryLabels.appearance },
  { id: "toggle-sidebar", label: "切换侧边栏", icon: "layout-left", shortcut: "Cmd+B", category: categoryLabels.appearance },
];

function formatShortcut(shortcut: string): string[] {
  return shortcut.split("+");
}

function Highlight(props: { text: string; query: string }) {
  const parts = createMemo(() => {
    const q = props.query.trim().toLowerCase();
    if (!q) return [{ text: props.text, match: false }];
    const result: { text: string; match: boolean }[] = [];
    let remaining = props.text;
    let index = remaining.toLowerCase().indexOf(q);
    while (index !== -1) {
      if (index > 0) {
        result.push({ text: remaining.slice(0, index), match: false });
      }
      result.push({ text: remaining.slice(index, index + q.length), match: true });
      remaining = remaining.slice(index + q.length);
      index = remaining.toLowerCase().indexOf(q);
    }
    if (remaining) {
      result.push({ text: remaining, match: false });
    }
    return result;
  });

  return (
    <>
      <For each={parts()}>
        {(part) => (
          <Show when={part.match} fallback={<span>{part.text}</span>}>
            <span class="text-accent font-semibold underline decoration-accent/40 underline-offset-2">{part.text}</span>
          </Show>
        )}
      </For>
    </>
  );
}

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const { state, setMode, createSession, toggleTheme, toggleSidebar, addMessage, activeSession, closePalette } = useAppStore();
  const command = useCommand();
  const [query, setQuery] = createSignal(state().paletteQuery ?? "");
  const [skills] = createResource(() => props.open, listSkills, { initialValue: { skills: [], agents: [] } });
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let listRef: HTMLDivElement | undefined;

  createEffect(() => {
    setQuery(state().paletteQuery ?? "");
  });

  const registerSkills = () => {
    command.register("skills", () => {
      const items: AcpSkillItem[] = [
        ...(skills()?.skills ?? []),
        ...(skills()?.agents ?? []),
      ];
      return items.map((item) => ({
        id: `skill:${item.id}`,
        title: item.name,
        description: item.description,
        category: item.type === "agent" ? categoryLabels.agents : categoryLabels.skills,
        icon: (item.type === "agent" ? "subagent" : "sparkle-2") as IconName,
        slash: item.id,
        onSelect: () => runSkill(item.id),
      }));
    });
  };

  createEffect(() => {
    if (props.open) {
      registerSkills();
    }
  });

  const commandActions = createMemo(() => {
    return command.options().map((opt) => ({
      id: opt.id,
      label: opt.title,
      description: opt.description,
      icon: opt.icon ?? "sparkle-2",
      shortcut: opt.keybind,
      category: mapCategory(opt.category),
      slash: opt.slash,
      onSelect: opt.onSelect,
    }));
  });

  const allActions = createMemo(() => [...systemActions, ...commandActions()]);

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const slashPrefix = q.startsWith("/") ? q.slice(1) : "";
    const search = slashPrefix || q;

    return allActions().filter((a) => {
      if (!search) return true;
      if (slashPrefix && a.slash) {
        return a.slash.toLowerCase().includes(slashPrefix);
      }
      return (
        a.label.toLowerCase().includes(search) ||
        a.id.toLowerCase().includes(search) ||
        (a.description?.toLowerCase().includes(search) ?? false) ||
        (a.slash?.toLowerCase().includes(search) ?? false)
      );
    });
  });

  createEffect(() => {
    filtered();
    setSelectedIndex(0);
  });

  createEffect(() => {
    const index = selectedIndex();
    const item = listRef?.querySelector(`[data-cmd-index="${index}"]`);
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  });

  const runSkill = async (skillId: string) => {
    const session = activeSession();
    if (session) {
      addMessage(session.id, {
        role: "assistant",
        content: `执行 skill: ${skillId}...`,
        status: "streaming",
      });
    }
    try {
      const result = await executeSkill(skillId);
      if (session) {
        addMessage(session.id, {
          role: "assistant",
          content: `\`\`\`json\n${JSON.stringify(result.output, null, 2).slice(0, 2000)}\n\`\`\``,
          status: "done",
        });
      }
    } catch (error) {
      if (session) {
        addMessage(session.id, {
          role: "assistant",
          content: `执行失败: ${error instanceof Error ? error.message : String(error)}`,
          status: "error",
        });
      }
    }
    closePalette();
  };

  const execute = (action: Action) => {
    if (action.onSelect) {
      action.onSelect("palette");
      closePalette();
      return;
    }

    if (action.id === "new-session") {
      createSession();
      setMode("chat");
    } else if (action.id === "toggle-theme") {
      toggleTheme();
    } else if (action.id === "toggle-sidebar") {
      toggleSidebar();
    } else {
      setMode(action.id as ViewMode);
    }
    closePalette();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = filtered();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = items[selectedIndex()];
      if (action) execute(action);
    } else if (e.key === "Escape") {
      closePalette();
    }
  };

  onMount(() => {
    const input = document.getElementById("cmd-input") as HTMLInputElement | null;
    input?.focus();
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const grouped = createMemo(() => {
    const map = new Map<string, Action[]>();
    for (const action of filtered()) {
      const list = map.get(action.category) ?? [];
      list.push(action);
      map.set(action.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = categoryOrder.indexOf(a);
      const bi = categoryOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  });

  const globalIndexOf = (action: Action) => filtered().indexOf(action);

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-[60] flex items-start justify-center pt-28 bg-background/70 backdrop-blur-sm"
        onClick={closePalette}
      >
        <div
          class="w-full max-w-2xl bg-popover border border-border rounded-2xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="flex items-center gap-3 px-4 h-14 border-b border-border">
            <Icon name="magnifying-glass" size="normal" class="text-muted-foreground shrink-0" />
            <input
              id="cmd-input"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              class="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
              placeholder="输入命令或搜索，按 / 过滤 skill..."
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
            />
            <kbd class="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground border border-border">ESC</kbd>
          </div>

          <div ref={listRef} class="max-h-[26rem] overflow-y-auto py-1">
            <For each={grouped()}>
              {([category, items]) => (
                <div>
                  <div class="px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold sticky top-0 bg-popover/95 backdrop-blur">
                    {category}
                  </div>
                  <For each={items}>
                    {(action) => {
                      const index = () => globalIndexOf(action);
                      const active = () => index() === selectedIndex();
                      return (
                        <button
                          type="button"
                          data-cmd-index={index()}
                          onClick={() => execute(action)}
                          class={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-all duration-150 outline-none focus-visible:bg-accent/10 focus-visible:border-l-2 focus-visible:border-accent ${
                            active()
                              ? "bg-accent/10 border-l-2 border-accent"
                              : "hover:bg-muted border-l-2 border-transparent"
                          }`}
                          onMouseEnter={() => setSelectedIndex(index())}
                        >
                          <div class={`p-1 rounded-md ${active() ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"}`}>
                            <Icon name={action.icon} size="normal" />
                          </div>
                          <span class="flex-1 min-w-0">
                            <span class="block truncate">
                              <Highlight text={action.label} query={query()} />
                            </span>
                            {action.description && (
                              <span class="block text-xs text-muted-foreground truncate">
                                <Highlight text={action.description} query={query()} />
                              </span>
                            )}
                          </span>
                          <span class="flex items-center gap-1.5 shrink-0">
                            {action.slash && (
                              <kbd class="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground border border-border">
                                /{action.slash}
                              </kbd>
                            )}
                            {action.shortcut && (
                              <span class="hidden sm:flex items-center gap-0.5">
                                <For each={formatShortcut(action.shortcut)}>
                                  {(key) => (
                                    <kbd class="text-[10px] min-w-[1.25rem] text-center px-1 py-0.5 bg-muted rounded text-muted-foreground border border-border">
                                      {key}
                                    </kbd>
                                  )}
                                </For>
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>

            <Show when={filtered().length === 0}>
              <div class="oc-empty-state py-10">
                <div class="oc-empty-state-icon">
                  <Icon name="magnifying-glass" size="large" />
                </div>
                <div class="oc-empty-state-title">未找到匹配的命令</div>
                <div class="oc-empty-state-desc">尝试其他关键词，或按 / 过滤 skill。</div>
              </div>
            </Show>
          </div>

          <div class="hidden sm:flex items-center justify-between px-4 py-2 border-t border-border bg-muted/30 text-[10px] text-muted-foreground">
            <div class="flex items-center gap-3">
              <span class="flex items-center gap-1">
                <kbd class="px-1 py-0.5 bg-muted rounded border border-border">↑</kbd>
                <kbd class="px-1 py-0.5 bg-muted rounded border border-border">↓</kbd>
                导航
              </span>
              <span class="flex items-center gap-1">
                <kbd class="px-1 py-0.5 bg-muted rounded border border-border">↵</kbd>
                选择
              </span>
            </div>
            <span>按 / 过滤 skill</span>
          </div>
        </div>
      </div>
    </Show>
  );
};
