import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Icon } from "../Icon";
import { desktopRequest } from "../../services/desktop";
import {
  type AgentMode,
  type ComposerCommand,
  type ComposerCommandId,
  type ComposerFileContext,
  type ComposerTrigger,
  filterComposerCommands,
  findComposerCommand,
  findComposerTrigger,
  removeComposerTrigger,
} from "./chat-composer-model";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

type ComposerSuggestion =
  | { kind: "file"; file: ComposerFileContext }
  | { kind: "command"; command: ComposerCommand };

interface ChatComposerProps {
  value: string;
  mode: AgentMode;
  providerLabel: string;
  busy: boolean;
  files: ComposerFileContext[];
  command?: ComposerCommandId;
  onValueChange: (value: string) => void;
  onModeChange: (mode: AgentMode) => void;
  onFilesChange: (files: ComposerFileContext[]) => void;
  onCommandChange: (command?: ComposerCommandId) => void;
  onSubmit: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
  onReady?: (textarea: HTMLTextAreaElement) => void;
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".next",
  ".openstar",
  ".openstar-agents",
  ".output",
  ".tmp",
  ".turbo",
  ".vite",
  "%systemdrive%",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "nvidia corporation",
  "target",
]);

function pathName(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || path;
}

const SOURCE_DIRECTORY_PRIORITY = new Map([
  ["packages", 0],
  ["ui-web", 1],
  ["src", 2],
  ["components", 3],
  ["workbench", 4],
]);

function directoryPriority(path: string): number {
  return (
    SOURCE_DIRECTORY_PRIORITY.get(pathName(path).toLocaleLowerCase()) ?? 100
  );
}

async function collectWorkspaceFiles(
  onProgress?: (files: ComposerFileContext[]) => void,
  shouldContinue: () => boolean = () => true,
): Promise<ComposerFileContext[]> {
  const queue: Array<{ path: string; depth: number }> = [
    { path: ".", depth: 0 },
  ];
  const files: ComposerFileContext[] = [];
  const visited = new Set<string>();
  let directoryCount = 0;

  while (
    shouldContinue() &&
    queue.length &&
    files.length < 800 &&
    directoryCount < 72
  ) {
    const current = queue.shift()!;
    if (visited.has(current.path)) continue;
    visited.add(current.path);
    directoryCount += 1;
    const result = await desktopRequest<{ entries: FileEntry[] }>(
      "files/list",
      {
        path: current.path,
      },
    );
    if (!shouldContinue()) break;
    const entries = [...result.entries].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    for (const entry of entries) {
      if (entry.type === "file") {
        files.push({
          path: entry.path,
          name: entry.name || pathName(entry.path),
        });
        if (files.length >= 800) break;
      } else if (
        current.depth < 6 &&
        !IGNORED_DIRECTORIES.has(entry.name.toLocaleLowerCase())
      ) {
        queue.push({ path: entry.path, depth: current.depth + 1 });
      }
    }
    queue.sort(
      (left, right) =>
        directoryPriority(left.path) - directoryPriority(right.path) ||
        left.depth - right.depth ||
        left.path.localeCompare(right.path),
    );
    onProgress?.([...new Map(files.map((file) => [file.path, file])).values()]);
  }

  return [...new Map(files.map((file) => [file.path, file])).values()];
}

const ChatComposer: Component<ChatComposerProps> = (props) => {
  const [caret, setCaret] = createSignal(0);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [workspaceFiles, setWorkspaceFiles] = createSignal<
    ComposerFileContext[]
  >([]);
  const [filesLoaded, setFilesLoaded] = createSignal(false);
  const [filesLoading, setFilesLoading] = createSignal(false);
  const [filesError, setFilesError] = createSignal("");
  const [dismissedTriggerKey, setDismissedTriggerKey] = createSignal("");
  let textarea!: HTMLTextAreaElement;
  let fileIndexGeneration = 0;

  const rawTrigger = createMemo(() =>
    findComposerTrigger(props.value, caret()),
  );
  const triggerKey = createMemo(() => {
    const trigger = rawTrigger();
    return trigger
      ? `${trigger.kind}:${trigger.start}:${trigger.end}:${trigger.query}`
      : "";
  });
  const trigger = createMemo(() =>
    triggerKey() && triggerKey() !== dismissedTriggerKey()
      ? rawTrigger()
      : null,
  );
  const selectedCommand = createMemo(() => findComposerCommand(props.command));

  const fileSuggestions = createMemo(() => {
    const active = trigger();
    if (active?.kind !== "file") return [];
    const query = active.query.trim().toLocaleLowerCase();
    const selected = new Set(props.files.map((file) => file.path));
    return workspaceFiles()
      .filter((file) => !selected.has(file.path))
      .filter((file) => {
        if (!query) return true;
        return `${file.path} ${file.name}`.toLocaleLowerCase().includes(query);
      })
      .slice(0, 12);
  });

  const suggestions = createMemo<ComposerSuggestion[]>(() => {
    const active = trigger();
    if (!active) return [];
    if (active.kind === "command") {
      return filterComposerCommands(active.query).map((command) => ({
        kind: "command" as const,
        command,
      }));
    }
    return fileSuggestions().map((file) => ({ kind: "file" as const, file }));
  });

  const ensureFiles = async () => {
    if (filesLoaded() || filesLoading()) return;
    const generation = ++fileIndexGeneration;
    const isCurrent = () => generation === fileIndexGeneration;
    setFilesLoading(true);
    setFilesError("");
    try {
      const files = await collectWorkspaceFiles((current) => {
        if (isCurrent()) setWorkspaceFiles(current);
      }, isCurrent);
      if (!isCurrent()) return;
      setWorkspaceFiles(files);
      setFilesLoaded(true);
    } catch (cause) {
      if (isCurrent())
        setFilesError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (isCurrent()) setFilesLoading(false);
    }
  };

  createEffect(() => {
    if (trigger()?.kind === "file") void ensureFiles();
  });

  createEffect(() => {
    triggerKey();
    setSelectedIndex(0);
  });

  onCleanup(() => {
    fileIndexGeneration += 1;
  });

  const updateCaret = () =>
    setCaret(textarea.selectionStart ?? props.value.length);

  const replaceTrigger = (active: ComposerTrigger) => {
    const next = removeComposerTrigger(props.value, active);
    props.onValueChange(next.text);
    setDismissedTriggerKey("");
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  };

  const chooseSuggestion = (suggestion: ComposerSuggestion) => {
    const active = trigger();
    if (!active) return;
    if (suggestion.kind === "file") {
      props.onFilesChange([...props.files, suggestion.file]);
    } else {
      props.onCommandChange(suggestion.command.id);
      props.onModeChange(suggestion.command.mode);
    }
    replaceTrigger(active);
  };

  const insertTrigger = (prefix: "@" | "/") => {
    const start = textarea.selectionStart ?? props.value.length;
    const end = textarea.selectionEnd ?? start;
    const before = props.value.slice(0, start);
    const after = props.value.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${lead}${prefix}${after}`;
    const nextCaret = before.length + lead.length + 1;
    props.onValueChange(next);
    setDismissedTriggerKey("");
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const items = suggestions();
    if (trigger() && items.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => (index - 1 + items.length) % items.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const suggestion = items[selectedIndex()];
        if (suggestion) chooseSuggestion(suggestion);
        return;
      }
    }
    if (event.key === "Escape" && trigger()) {
      event.preventDefault();
      setDismissedTriggerKey(triggerKey());
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      props.onSubmit();
    }
  };

  return (
    <div class="oc-v2-prompt-region">
      <form
        class="oc-v2-prompt-dock oc-v2-composer-v2"
        data-context-count={props.files.length + (props.command ? 1 : 0)}
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <Show when={trigger()}>
          {(active) => (
            <div
              id="chat-composer-suggestions"
              class="oc-v2-composer-menu"
              role="listbox"
              aria-label={
                active().kind === "file"
                  ? "引用工作区文件"
                  : "选择 Slash command"
              }
            >
              <header>
                <span>
                  {active().kind === "file" ? "@ 引用文件" : "/ 工作流命令"}
                </span>
                <small>{active().query || "全部"}</small>
              </header>
              <Show
                when={suggestions().length}
                fallback={
                  <div class="oc-v2-composer-menu-empty">
                    <Show
                      when={active().kind === "file" && filesLoading()}
                      fallback={
                        <Show
                          when={active().kind === "file" && filesError()}
                          fallback={<span>没有匹配项</span>}
                        >
                          <span>{filesError()}</span>
                        </Show>
                      }
                    >
                      <span>正在索引工作区文件…</span>
                    </Show>
                  </div>
                }
              >
                <For each={suggestions()}>
                  {(suggestion, index) => (
                    <button
                      type="button"
                      class="oc-v2-composer-menu-row"
                      classList={{ "is-selected": index() === selectedIndex() }}
                      role="option"
                      aria-selected={index() === selectedIndex()}
                      onMouseEnter={() => setSelectedIndex(index())}
                      onClick={() => chooseSuggestion(suggestion)}
                    >
                      <span class="oc-v2-composer-menu-icon">
                        <Icon
                          name={
                            suggestion.kind === "file" ? "file" : "sparkle-2"
                          }
                          size="small"
                        />
                      </span>
                      <span class="oc-v2-composer-menu-copy">
                        <strong>
                          {suggestion.kind === "file"
                            ? suggestion.file.name
                            : `/${suggestion.command.id}`}
                        </strong>
                        <small>
                          {suggestion.kind === "file"
                            ? suggestion.file.path
                            : suggestion.command.description}
                        </small>
                      </span>
                      <kbd>{index() === selectedIndex() ? "↵" : ""}</kbd>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          )}
        </Show>

        <Show when={props.files.length || selectedCommand()}>
          <div class="oc-v2-composer-context" aria-label="当前 Prompt 上下文">
            <Show when={selectedCommand()}>
              {(command) => (
                <span class="oc-v2-context-chip is-command">
                  <Icon name="sparkle-2" size="small" />
                  <strong>/{command().id}</strong>
                  <button
                    type="button"
                    aria-label={`移除 /${command().id}`}
                    onClick={() => props.onCommandChange(undefined)}
                  >
                    <Icon name="close-small" size="small" />
                  </button>
                </span>
              )}
            </Show>
            <For each={props.files}>
              {(file) => (
                <span class="oc-v2-context-chip" title={file.path}>
                  <Icon name="file" size="small" />
                  <strong>{file.name}</strong>
                  <button
                    type="button"
                    aria-label={`移除 ${file.path}`}
                    onClick={() =>
                      props.onFilesChange(
                        props.files.filter((item) => item.path !== file.path),
                      )
                    }
                  >
                    <Icon name="close-small" size="small" />
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>

        <textarea
          ref={(element) => {
            textarea = element;
            props.onReady?.(element);
          }}
          id="chat-composer"
          aria-label="发送给当前 Provider"
          aria-controls={trigger() ? "chat-composer-suggestions" : undefined}
          placeholder={
            props.busy
              ? "当前会话仍在运行…"
              : props.mode === "plan"
                ? "描述目标，代理将先分析并给出计划…"
                : "Ask anything... 使用 @ 引用文件，/ 选择命令"
          }
          value={props.value}
          onInput={(event) => {
            props.onValueChange(event.currentTarget.value);
            setDismissedTriggerKey("");
            updateCaret();
          }}
          onClick={updateCaret}
          onKeyUp={updateCaret}
          onSelect={updateCaret}
          onKeyDown={handleKeyDown}
        />

        <div class="oc-v2-prompt-toolbar">
          <button
            type="button"
            class="oc-v2-composer-trigger-button"
            aria-label="引用工作区文件"
            title="引用文件 (@)"
            onClick={() => insertTrigger("@")}
          >
            <Icon name="plus-small" size="small" />
            <span>@</span>
          </button>
          <button
            type="button"
            class="oc-v2-composer-trigger-button"
            aria-label="选择工作流命令"
            title="Slash command (/)"
            onClick={() => insertTrigger("/")}
          >
            <Icon name="sparkle-2" size="small" />
            <span>/</span>
          </button>
          <select
            class="oc-v2-agent-select"
            aria-label="Agent mode"
            value={props.mode}
            onChange={(event) =>
              props.onModeChange(event.currentTarget.value as AgentMode)
            }
          >
            <option value="build">Build</option>
            <option value="plan">Plan</option>
          </select>
          <button
            type="button"
            class="oc-v2-provider-button"
            title={props.providerLabel}
            onClick={props.onOpenSettings}
          >
            <Icon name="models" size="small" />
            <span>{props.providerLabel || "Select model"}</span>
          </button>
          <span class="oc-v2-prompt-hint">
            @ 文件 · / 命令 · Enter 发送 · Shift Enter 换行
          </span>
          <Show
            when={props.busy}
            fallback={
              <button
                type="submit"
                class="oc-v2-send-button"
                disabled={!props.value.trim()}
                aria-label="发送消息"
              >
                <Icon name="arrow-up" size="small" />
              </button>
            }
          >
            <button
              type="button"
              class="oc-v2-stop-button"
              aria-label="停止生成"
              onClick={props.onStop}
            >
              <Icon name="stop" size="small" />
            </button>
          </Show>
        </div>
      </form>
      <p class="oc-v2-prompt-policy">
        {props.mode === "plan"
          ? "Plan 模式先分析和规划，不直接修改文件。"
          : "Build 模式可修改、执行并验证。"}
        <Show when={props.files.length || selectedCommand()}>
          <span>
            {" "}
            · 当前 Prompt 包含 {props.files.length} 个文件
            {selectedCommand() ? ` 和 /${selectedCommand()!.id}` : ""}
          </span>
        </Show>
      </p>
    </div>
  );
};

export default ChatComposer;
