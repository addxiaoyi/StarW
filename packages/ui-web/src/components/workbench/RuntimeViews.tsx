import {
  type Component,
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Icon } from "../Icon";
import SchemaArgumentsEditor from "./SchemaArgumentsEditor";
import {
  chooseWorkspace,
  desktopRequest,
  openExternal,
  subscribeDesktopEvent,
} from "../../services/desktop";
import {
  errorText,
  findNextTextMatch,
  formatBytes,
  formatValue,
  isRecord,
  joinWorkspacePath,
  LARGE_FILE_WARNING_BYTES,
  MAX_FILE_PREVIEW_BYTES,
  parentWorkspacePath,
} from "./runtime-view-utils";
import {
  approvalRemainingSeconds,
  classifyAgentDesktopEvent,
  filterAgentEvents,
  summarizeAgentEvent,
  visibleAgentEvents,
  type AgentRuntimeEvent,
} from "./agent-runtime-utils";
import AgentEditorPanel from "./AgentEditorPanel";
import AgentOrchestrationPanel from "./AgentOrchestrationPanel";
import type { AgentDefinitionItem } from "./agent-editor-model";

type RuntimeChanged = () => void;

const EmptyState: Component<{ title: string; detail: string }> = (props) => (
  <div class="oc-empty-state">
    <strong>{props.title}</strong>
    <span>{props.detail}</span>
  </div>
);

const ErrorNotice: Component<{ message: string }> = (props) => (
  <div class="oc-notice oc-notice-error" role="alert" aria-live="assertive">
    {props.message}
  </div>
);

interface RuntimeViewProps {
  focusTarget?: {
    value: string;
    nonce: number;
  };
  onRuntimeChanged?: RuntimeChanged;
  onDirtyChange?: (dirty: boolean) => void;
}

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modifiedAt?: number;
}

export const FilesRuntimeView: Component<RuntimeViewProps> = (props) => {
  const [currentPath, setCurrentPath] = createSignal(".");
  const [workspace, setWorkspace] = createSignal("");
  const [entries, setEntries] = createSignal<FileEntry[]>([]);
  const [selectedPath, setSelectedPath] = createSignal("");
  const [content, setContent] = createSignal("");
  const [dirty, setDirty] = createSignal(false);
  const [selectedModifiedAt, setSelectedModifiedAt] = createSignal<
    number | undefined
  >();
  const [conflict, setConflict] = createSignal<{
    content: string;
    modifiedAt: number;
  } | null>(null);
  const [directoryLoading, setDirectoryLoading] = createSignal(false);
  const [fileLoading, setFileLoading] = createSignal(false);
  const [selectedSize, setSelectedSize] = createSignal<number | undefined>();
  const [readOnly, setReadOnly] = createSignal(false);
  const [searchText, setSearchText] = createSignal("");
  const [searchMatch, setSearchMatch] = createSignal(0);
  let directoryRequestSequence = 0;
  let fileRequestSequence = 0;
  let editor!: HTMLTextAreaElement;
  let lineGutter!: HTMLPreElement;
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");

  createEffect(() => props.onDirtyChange?.(dirty()));

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };

  const loadDirectory = async (requested = "."): Promise<boolean> => {
    const requestId = ++directoryRequestSequence;
    setDirectoryLoading(true);
    setError("");
    try {
      const result = await desktopRequest<{
        entries: FileEntry[];
        path: string;
        workspace: string;
      }>("files/list", { path: requested });
      if (requestId !== directoryRequestSequence) return false;
      setEntries(result.entries);
      setCurrentPath(result.path || ".");
      setWorkspace(result.workspace);
      return true;
    } catch (cause) {
      if (requestId === directoryRequestSequence) setError(errorText(cause));
      return false;
    } finally {
      if (requestId === directoryRequestSequence) setDirectoryLoading(false);
    }
  };

  const confirmDiscardChanges = (destination: string): boolean => {
    if (!dirty()) return true;
    return window.confirm(
      `${selectedPath() || "当前文件"} 有未保存修改。确定要${destination}并放弃这些修改吗？`,
    );
  };

  const clearSelection = () => {
    setSelectedPath("");
    setContent("");
    setSelectedModifiedAt(undefined);
    setSelectedSize(undefined);
    setReadOnly(false);
    setSearchText("");
    setSearchMatch(0);
    setConflict(null);
    setDirty(false);
  };

  const navigateDirectory = async (path: string) => {
    if (!confirmDiscardChanges("切换目录")) return;
    fileRequestSequence += 1;
    if (!(await loadDirectory(path))) return;
    clearSelection();
  };

  const openEntry = async (entry: FileEntry) => {
    if (entry.type === "directory") {
      await navigateDirectory(entry.path);
      return;
    }
    if (
      entry.path !== selectedPath() &&
      !confirmDiscardChanges("打开其他文件")
    ) {
      return;
    }
    if ((entry.size ?? 0) > MAX_FILE_PREVIEW_BYTES) {
      setSelectedPath(entry.path);
      setSelectedSize(entry.size);
      setContent("");
      setReadOnly(true);
      setDirty(false);
      setError(
        `${entry.name} 为 ${formatBytes(entry.size)}，超过 5 MiB 预览上限。请使用外部编辑器处理。`,
      );
      return;
    }
    const shouldUseReadOnly = (entry.size ?? 0) > LARGE_FILE_WARNING_BYTES;
    if (
      shouldUseReadOnly &&
      !window.confirm(
        `${entry.name} 大小为 ${formatBytes(entry.size)}。为避免界面卡顿，将以只读模式打开，是否继续？`,
      )
    ) {
      return;
    }
    const requestId = ++fileRequestSequence;
    setFileLoading(true);
    setError("");
    try {
      const result = await desktopRequest<{
        content: string;
        path: string;
        size: number;
        modifiedAt: number;
      }>("files/read", { path: entry.path });
      if (requestId !== fileRequestSequence) return;
      setSelectedPath(result.path);
      setContent(result.content);
      setSelectedModifiedAt(result.modifiedAt);
      setSelectedSize(result.size);
      setReadOnly(shouldUseReadOnly);
      setSearchText("");
      setSearchMatch(0);
      setConflict(null);
      setDirty(false);
    } catch (cause) {
      if (requestId === fileRequestSequence) setError(errorText(cause));
    } finally {
      if (requestId === fileRequestSequence) setFileLoading(false);
    }
  };

  const parentPath = () => parentWorkspacePath(currentPath());

  const findNext = () => {
    const query = searchText();
    if (!query || !editor) return;
    const match = findNextTextMatch(
      content(),
      query,
      editor.selectionEnd,
      searchMatch(),
    );
    if (!match) {
      setError(`未找到“${query}”`);
      return;
    }
    setError("");
    setSearchMatch(match.end);
    editor.focus();
    editor.setSelectionRange(match.start, match.end);
  };

  const createEntry = async (kind: "file" | "directory") => {
    const label = kind === "directory" ? "文件夹" : "文件";
    const name = window.prompt(`新建${label}名称`);
    const path = joinWorkspacePath(currentPath(), name ?? "");
    if (!path) return;
    try {
      await desktopRequest("files/create", { path, kind });
      await loadDirectory(currentPath());
      props.onRuntimeChanged?.();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const renameOrMoveEntry = async (entry: FileEntry) => {
    if (entry.path === selectedPath() && !confirmDiscardChanges("重命名或移动"))
      return;
    const nextPath = window.prompt("新的工作区相对路径", entry.path);
    if (!nextPath?.trim() || nextPath.trim() === entry.path) return;
    try {
      await desktopRequest("files/rename", {
        path: entry.path,
        newPath: nextPath.trim(),
      });
      if (entry.path === selectedPath()) clearSelection();
      await loadDirectory(currentPath());
      props.onRuntimeChanged?.();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const deleteEntry = async (entry: FileEntry) => {
    if (entry.path === selectedPath() && !confirmDiscardChanges("删除")) return;
    if (!window.confirm(`确定删除 ${entry.path}？此操作会写入变更记录。`))
      return;
    const recursive =
      entry.type === "directory" &&
      window.confirm("若文件夹非空，是否递归删除其中全部内容？");
    try {
      await desktopRequest("files/delete", {
        path: entry.path,
        recursive,
      });
      if (entry.path === selectedPath()) clearSelection();
      await loadDirectory(currentPath());
      props.onRuntimeChanged?.();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const handleEditorShortcut = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (dirty() && !saving() && !readOnly()) void saveFile();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      document.getElementById("file-editor-search")?.focus();
    }
  };

  const loadLatestSelectedVersion = async () => {
    const path = selectedPath();
    if (!path) return null;
    const latest = await desktopRequest<{
      content: string;
      path: string;
      modifiedAt: number;
    }>("files/read", { path });
    return latest.path === selectedPath() ? latest : null;
  };

  const showExternalConflict = async () => {
    try {
      const latest = await loadLatestSelectedVersion();
      if (!latest) return;
      if (!dirty()) {
        setContent(latest.content);
        setSelectedModifiedAt(latest.modifiedAt);
        setConflict(null);
        return;
      }
      setConflict({ content: latest.content, modifiedAt: latest.modifiedAt });
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const saveFile = async (force = false) => {
    if (!selectedPath()) return;
    setSaving(true);
    setError("");
    try {
      const expectedModifiedAt = selectedModifiedAt();
      const result = await desktopRequest<{ modifiedAt: number }>(
        "files/write",
        {
          path: selectedPath(),
          content: content(),
          ...(force || expectedModifiedAt === undefined
            ? {}
            : { expectedModifiedAt }),
        },
      );
      setSelectedModifiedAt(result.modifiedAt);
      setConflict(null);
      setDirty(false);
      await loadDirectory(currentPath());
      props.onRuntimeChanged?.();
    } catch (cause) {
      const message = errorText(cause);
      if (message.includes("FILE_MODIFIED_EXTERNALLY")) {
        setError("文件已被外部修改。请比较后选择重新加载或覆盖磁盘版本。");
        await showExternalConflict();
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const reloadExternalVersion = () => {
    const latest = conflict();
    if (!latest) return;
    setContent(latest.content);
    setSelectedModifiedAt(latest.modifiedAt);
    setConflict(null);
    setDirty(false);
    setError("");
  };

  const selectWorkspace = async () => {
    if (!confirmDiscardChanges("切换工作区")) return;
    try {
      const selected = await chooseWorkspace();
      if (!selected) return;
      fileRequestSequence += 1;
      await desktopRequest("config/set", { workspace: selected });
      if (!(await loadDirectory("."))) return;
      clearSelection();
      props.onRuntimeChanged?.();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  onMount(() => {
    void loadDirectory(".");
    window.addEventListener("beforeunload", handleBeforeUnload);
  });
  const unsubscribe = subscribeDesktopEvent((event, payload) => {
    if (event !== "file.changed") return;
    const record = isRecord(payload) ? payload : null;
    const changedPath = typeof record?.path === "string" ? record.path : "";
    const modifiedAt =
      typeof record?.modifiedAt === "number" ? record.modifiedAt : undefined;
    if (
      changedPath === selectedPath() &&
      !saving() &&
      (modifiedAt === undefined ||
        selectedModifiedAt() === undefined ||
        Math.abs(modifiedAt - selectedModifiedAt()!) > 0)
    ) {
      void showExternalConflict();
    }
    void loadDirectory(currentPath());
  });
  onCleanup(() => {
    directoryRequestSequence += 1;
    fileRequestSequence += 1;
    unsubscribe();
    window.removeEventListener("beforeunload", handleBeforeUnload);
    props.onDirtyChange?.(false);
  });

  return (
    <section class="oc-runtime-page oc-files-page flex h-full min-h-0 flex-col">
      <div class="oc-files-commandbar">
        <div class="oc-files-location">
          <span class="oc-context-kicker">Workspace files</span>
          <strong title={currentPath()}>{currentPath()}</strong>
        </div>
        <div class="oc-files-actions">
          <button
            class="oc-button"
            disabled={currentPath() === "." || directoryLoading()}
            onClick={() => void navigateDirectory(parentPath())}
          >
            <Icon name="chevron-left" size="small" />
            上级
          </button>
          <button
            class="oc-button"
            disabled={directoryLoading()}
            onClick={() => void loadDirectory(currentPath())}
          >
            {directoryLoading() ? "刷新中…" : "刷新"}
          </button>
          <button class="oc-button" onClick={() => void selectWorkspace()}>
            切换工作区
          </button>
          <button class="oc-button" onClick={() => void createEntry("file")}>
            新建文件
          </button>
          <button
            class="oc-button"
            onClick={() => void createEntry("directory")}
          >
            新建文件夹
          </button>
          <Show when={selectedPath()}>
            <button
              class="oc-button oc-button-primary oc-browser-submit"
              disabled={!dirty() || saving() || readOnly()}
              onClick={() => void saveFile()}
            >
              {saving() ? "保存中…" : "保存"}
            </button>
          </Show>
        </div>
      </div>
      <Show when={error()}>
        <div class="p-3">
          <ErrorNotice message={error()} />
        </div>
      </Show>
      <Show when={conflict()}>
        {(latest) => (
          <section class="mx-3 mt-3 rounded-md border border-warning/60 bg-warning/10 p-3 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="text-warning">磁盘版本已变化</strong>
              <span class="text-muted-foreground">
                当前编辑内容尚未保存，请选择处理方式。
              </span>
              <span class="flex-1" />
              <button class="oc-button" onClick={reloadExternalVersion}>
                重新加载磁盘版本
              </button>
              <button
                class="oc-button oc-button-primary"
                disabled={saving()}
                onClick={() => void saveFile(true)}
              >
                覆盖磁盘版本
              </button>
            </div>
            <details class="mt-3">
              <summary class="cursor-pointer text-xs">
                比较当前编辑与磁盘版本
              </summary>
              <div class="mt-2 grid gap-2 lg:grid-cols-2">
                <div>
                  <strong class="text-xs">当前编辑</strong>
                  <pre class="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs">
                    {content()}
                  </pre>
                </div>
                <div>
                  <strong class="text-xs">磁盘版本</strong>
                  <pre class="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs">
                    {latest().content}
                  </pre>
                </div>
              </div>
            </details>
          </section>
        )}
      </Show>
      <div class="oc-page-body runtime-split files-runtime grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
        <aside
          class="runtime-sidebar files-runtime-sidebar overflow-auto border-r border-border"
          aria-busy={directoryLoading()}
        >
          <Show
            when={entries().length > 0}
            fallback={
              <EmptyState
                title={directoryLoading() ? "正在读取目录" : "目录为空"}
                detail="列表来自内置引擎的真实文件系统边界。"
              />
            }
          >
            <For each={entries()}>
              {(entry) => (
                <div class="flex items-center border-b border-border/50">
                  <button
                    type="button"
                    class="oc-file-row"
                    classList={{ "bg-muted": selectedPath() === entry.path }}
                    aria-current={
                      selectedPath() === entry.path ? "page" : undefined
                    }
                    title={entry.path}
                    onClick={() => void openEntry(entry)}
                  >
                    <Icon
                      name={entry.type === "directory" ? "folder-open" : "code"}
                      size="small"
                    />
                    <span class="min-w-0 flex-1 truncate">{entry.name}</span>
                    <Show when={entry.size !== undefined}>
                      <small class="text-muted-foreground">
                        {formatBytes(entry.size)}
                      </small>
                    </Show>
                  </button>
                  <button
                    type="button"
                    class="sc-icon-button shrink-0"
                    aria-label={`重命名或移动 ${entry.name}`}
                    title="重命名或移动"
                    onClick={() => void renameOrMoveEntry(entry)}
                  >
                    <Icon name="pencil-line" size="small" />
                  </button>
                  <button
                    type="button"
                    class="sc-icon-button shrink-0 text-error"
                    aria-label={`删除 ${entry.name}`}
                    title="删除"
                    onClick={() => void deleteEntry(entry)}
                  >
                    <Icon name="trash" size="small" />
                  </button>
                </div>
              )}
            </For>
          </Show>
        </aside>
        <main
          class="runtime-main files-runtime-main min-h-0 overflow-hidden"
          aria-busy={fileLoading()}
        >
          <Show
            when={selectedPath()}
            fallback={
              <EmptyState
                title="选择一个文件"
                detail="文本文件可直接读取、编辑并通过内置引擎保存。"
              />
            }
          >
            <div class="flex h-full min-h-0 flex-col">
              <div class="oc-file-tabbar">
                <span class="min-w-0 flex-1 truncate" title={selectedPath()}>
                  {selectedPath()}
                </span>
                <Show when={selectedSize() !== undefined}>
                  <span>{formatBytes(selectedSize())}</span>
                </Show>
                <Show when={readOnly()}>
                  <span class="text-warning">只读模式</span>
                </Show>
                <Show when={dirty()}>
                  <span class="text-warning">未保存</span>
                </Show>
                <label class="flex items-center gap-1" for="file-editor-search">
                  搜索
                  <input
                    id="file-editor-search"
                    class="w-40 rounded border border-border bg-background px-2 py-1 font-sans"
                    value={searchText()}
                    onInput={(event) => {
                      setSearchText(event.currentTarget.value);
                      setSearchMatch(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        findNext();
                      }
                    }}
                  />
                </label>
                <button
                  class="oc-button"
                  disabled={!searchText()}
                  onClick={findNext}
                >
                  下一个
                </button>
              </div>
              <div class="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] overflow-hidden">
                <pre
                  ref={lineGutter}
                  class="select-none overflow-hidden rounded-none border-r border-border bg-card px-2 py-4 text-right font-mono text-sm leading-[1.6] text-muted-foreground"
                  aria-hidden="true"
                >
                  {content()
                    .split("\n")
                    .map((_, index) => index + 1)
                    .join("\n")}
                </pre>
                <textarea
                  ref={editor}
                  id="file-editor"
                  class="min-h-0 flex-1 resize-none overflow-auto bg-background p-4 font-mono text-sm leading-[1.6] outline-none"
                  aria-label={`编辑文件 ${selectedPath()}`}
                  aria-readonly={readOnly()}
                  readOnly={readOnly()}
                  value={content()}
                  onInput={(event) => {
                    setContent(event.currentTarget.value);
                    setDirty(true);
                  }}
                  onKeyDown={handleEditorShortcut}
                  onScroll={(event) => {
                    if (lineGutter)
                      lineGutter.scrollTop = event.currentTarget.scrollTop;
                  }}
                  spellcheck={false}
                />
              </div>
            </div>
          </Show>
        </main>
      </div>
    </section>
  );
};

export { default as ChatRuntimeView } from "./ChatRuntimeView";

type AgentItem = AgentDefinitionItem;

interface AgentSessionItem {
  id: string;
  agent: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  prompt: string;
  parentSessionId?: string;
  branchFromMessageIndex?: number;
  taskId?: string;
  provider?: string;
  model?: string;
  error?: string;
  result?: {
    content: string;
    iterations: number;
    toolExecutions: number;
    finishReason: string;
    durationMs: number;
    usage?: Record<string, number>;
  };
  events: AgentRuntimeEvent[];
}

interface SwarmTask {
  id: string;
  name: string;
  status: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

interface ApprovalItem {
  id: string;
  sessionId: string;
  request: {
    tool: string;
    action: string;
    risk: string;
    summary: string;
    command?: string;
    paths?: string[];
  };
  createdAt: number;
  expiresAt: number;
}

interface ChangeItem {
  id: string;
  sessionId: string;
  tool: string;
  path: string;
  createdAt: number;
  diff: string;
  rolledBackAt?: number;
}

type AgentConfirmAction =
  | { kind: "delete-agent"; name: string }
  | { kind: "delete-session"; sessionId: string }
  | { kind: "rollback-change"; change: ChangeItem };

export const AgentsRuntimeView: Component<RuntimeViewProps> = (props) => {
  const [agents, setAgents] = createSignal<AgentItem[]>([]);
  const [sessions, setSessions] = createSignal<AgentSessionItem[]>([]);
  const [tasks, setTasks] = createSignal<SwarmTask[]>([]);
  const [approvals, setApprovals] = createSignal<ApprovalItem[]>([]);
  const [changes, setChanges] = createSignal<ChangeItem[]>([]);
  const [selectedAgent, setSelectedAgent] = createSignal("general");
  const [prompt, setPrompt] = createSignal("");
  const [error, setError] = createSignal("");
  const [refreshing, setRefreshing] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [editorAgentName, setEditorAgentName] = createSignal("");
  const [confirmAction, setConfirmAction] =
    createSignal<AgentConfirmAction | null>(null);
  const [confirmingAction, setConfirmingAction] = createSignal(false);
  const [renamingSessionId, setRenamingSessionId] = createSignal("");
  const [renameSessionText, setRenameSessionText] = createSignal("");
  const [visibleChanges, setVisibleChanges] = createSignal(20);
  const [eventFilter, setEventFilter] = createSignal("all");
  const [eventLimits, setEventLimits] = createSignal<Record<string, number>>(
    {},
  );
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [liveOutput, setLiveOutput] = createSignal<Record<string, string>>({});
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let refreshSequence = 0;

  createEffect(() => {
    const target = props.focusTarget;
    if (!target) return;
    const agent = agents().find(
      (item) =>
        item.name.toLocaleLowerCase() === target.value.toLocaleLowerCase(),
    );
    if (!agent || selectedAgent() === agent.name) return;
    setSelectedAgent(agent.name);
    setEditorAgentName("");
  });

  const refresh = async () => {
    const requestId = ++refreshSequence;
    setRefreshing(true);
    const results = await Promise.allSettled([
      desktopRequest<{ agents: AgentItem[] }>("agents/list"),
      desktopRequest<{ sessions: AgentSessionItem[] }>("agent.sessions.list"),
      desktopRequest<{ tasks: SwarmTask[] }>("swarm.status"),
      desktopRequest<{ approvals: ApprovalItem[] }>("approvals/list"),
      desktopRequest<{ changes: ChangeItem[] }>("changes/list"),
    ]);
    if (requestId !== refreshSequence) return;
    const failures: string[] = [];
    const [
      agentResult,
      sessionResult,
      swarmResult,
      approvalResult,
      changeResult,
    ] = results;
    if (agentResult.status === "fulfilled") {
      const nextAgents = agentResult.value.agents;
      setAgents(nextAgents);
      if (
        nextAgents.length &&
        !nextAgents.some((agent) => agent.name === selectedAgent())
      ) {
        setSelectedAgent(nextAgents[0].name);
      }
      if (
        editorAgentName() &&
        !nextAgents.some(
          (agent) => agent.name === editorAgentName() && !agent.builtIn,
        )
      ) {
        setEditorAgentName("");
      }
    } else failures.push(`Agent 定义：${errorText(agentResult.reason)}`);
    if (sessionResult.status === "fulfilled")
      setSessions(sessionResult.value.sessions);
    else failures.push(`Agent 会话：${errorText(sessionResult.reason)}`);
    if (swarmResult.status === "fulfilled") setTasks(swarmResult.value.tasks);
    else failures.push(`Swarm：${errorText(swarmResult.reason)}`);
    if (approvalResult.status === "fulfilled")
      setApprovals(approvalResult.value.approvals);
    else failures.push(`审批：${errorText(approvalResult.reason)}`);
    if (changeResult.status === "fulfilled")
      setChanges(changeResult.value.changes);
    else failures.push(`变更：${errorText(changeResult.reason)}`);
    setError(failures.length ? `部分数据加载失败\n${failures.join("\n")}` : "");
    setRefreshing(false);
  };

  const submit = async () => {
    if (!prompt().trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await desktopRequest("agent.run", {
        agent: selectedAgent(),
        prompt: prompt().trim(),
      });
      setPrompt("");
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (taskId: string) => {
    await desktopRequest("swarm.cancel", { taskId });
    await refresh();
  };

  const cancelSession = async (sessionId: string) => {
    await desktopRequest("agent.sessions.cancel", { sessionId });
    await refresh();
  };

  const editAgent = (agent: AgentItem) => {
    setSelectedAgent(agent.name);
    setEditorAgentName(agent.builtIn ? "" : agent.name);
  };

  const handleAgentSaved = async (name: string) => {
    await refresh();
    setSelectedAgent(name);
    setEditorAgentName(name);
  };

  const renameSession = (session: AgentSessionItem) => {
    setRenamingSessionId(session.id);
    setRenameSessionText(session.name || session.prompt);
  };

  const saveSessionName = async (sessionId: string) => {
    const name = renameSessionText().trim();
    if (!name) return;
    try {
      await desktopRequest("agent.sessions.rename", { sessionId, name });
      setRenamingSessionId("");
      setRenameSessionText("");
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const branchSession = async (sessionId: string) => {
    await desktopRequest("agent.sessions.branch", { sessionId });
    await refresh();
  };

  const retrySession = async (session: AgentSessionItem) => {
    await desktopRequest("agent.sessions.retry", {
      sessionId: session.id,
      prompt: session.prompt || "Continue from this branch",
    });
    await refresh();
  };

  const deleteSession = (sessionId: string) => {
    setConfirmAction({ kind: "delete-session", sessionId });
  };

  const resolveApproval = async (id: string, approved: boolean) => {
    await desktopRequest("approvals/resolve", { id, approved });
    await refresh();
  };

  const rollbackChange = (change: ChangeItem) => {
    setConfirmAction({ kind: "rollback-change", change });
  };

  const confirmActionTitle = () => {
    const action = confirmAction();
    if (!action) return "";
    if (action.kind === "delete-agent")
      return `删除自定义 Agent ${action.name}`;
    if (action.kind === "delete-session") return "删除 Agent 会话";
    return `回滚 ${action.change.path}`;
  };

  const runConfirmAction = async () => {
    const action = confirmAction();
    if (!action || confirmingAction()) return;
    setConfirmingAction(true);
    setError("");
    try {
      if (action.kind === "delete-agent") {
        await desktopRequest("agent.definitions.delete", { name: action.name });
        setSelectedAgent("general");
        setEditorAgentName("");
      } else if (action.kind === "delete-session") {
        await desktopRequest("agent.sessions.delete", {
          sessionId: action.sessionId,
        });
      } else {
        await desktopRequest("changes/rollback", { id: action.change.id });
      }
      setConfirmAction(null);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setConfirmingAction(false);
    }
  };

  const approvalRemaining = (approval: ApprovalItem) =>
    approvalRemainingSeconds(approval.expiresAt, nowMs());

  const filteredEvents = (events: AgentRuntimeEvent[]) =>
    filterAgentEvents(events, eventFilter());

  const visibleSessionEvents = (session: AgentSessionItem) =>
    visibleAgentEvents(
      session.events ?? [],
      eventFilter(),
      eventLimits()[session.id] ?? 40,
    );

  const showEarlierEvents = (sessionId: string) => {
    setEventLimits((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? 40) + 40,
    }));
  };

  const scheduleRefresh = (delay = 120) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), delay);
  };

  onMount(() => {
    void refresh();
    clockTimer = setInterval(() => setNowMs(Date.now()), 1000);
  });
  const unsubscribe = subscribeDesktopEvent((event, payload) => {
    const action = classifyAgentDesktopEvent(event, payload);
    if (action.kind === "append-output") {
      setLiveOutput((current) => ({
        ...current,
        [action.sessionId]: (current[action.sessionId] ?? "") + action.content,
      }));
      return;
    }
    if (action.kind === "clear-output") {
      setLiveOutput((current) => {
        const next = { ...current };
        delete next[action.sessionId];
        return next;
      });
      scheduleRefresh(action.refreshDelay);
      return;
    }
    if (action.kind === "refresh") scheduleRefresh(action.delay);
  });
  onCleanup(() => {
    unsubscribe();
    if (refreshTimer) clearTimeout(refreshTimer);
    if (clockTimer) clearInterval(clockTimer);
  });

  return (
    <section class="oc-runtime-page oc-agents-page flex h-full min-h-0 flex-col">
      <div class="oc-agents-commandbar">
        <div class="oc-agents-identity">
          <span class="oc-context-kicker">Orchestration</span>
          <strong>Agents</strong>
          <small>定义角色、审批高风险工具并追踪真实执行</small>
        </div>
        <div class="oc-agents-summary" aria-label="Agent 运行摘要">
          <span>{agents().length} agents</span>
          <span>{sessions().length} sessions</span>
          <Show when={approvals().length > 0}>
            <span class="is-warning">{approvals().length} approvals</span>
          </Show>
          <button
            class="oc-button"
            disabled={refreshing()}
            onClick={() => void refresh()}
          >
            {refreshing() ? "刷新中…" : "刷新"}
          </button>
        </div>
      </div>
      <Show when={error()}>
        <div class="p-3">
          <ErrorNotice message={error()} />
        </div>
      </Show>
      <div class="oc-page-body runtime-split agents-runtime grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
        <aside
          class="runtime-sidebar agents-runtime-sidebar overflow-auto border-r border-border p-3"
          aria-busy={refreshing()}
        >
          <For each={agents()}>
            {(agent) => (
              <button
                class="oc-agent-row"
                data-agent-name={agent.name}
                classList={{
                  "border-ring bg-muted": selectedAgent() === agent.name,
                }}
                onClick={() => editAgent(agent)}
              >
                <div class="flex items-center justify-between">
                  <strong>{agent.name}</strong>
                  <span class="text-xs text-muted-foreground">
                    {agent.status}
                  </span>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {agent.description}
                </p>
                <small>
                  {agent.tasks} task(s) · {agent.sessions} session(s)
                </small>
                <div class="mt-2 flex flex-wrap gap-1">
                  <For each={agent.tools ?? []}>
                    {(tool) => (
                      <span class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {tool}
                      </span>
                    )}
                  </For>
                </div>
              </button>
            )}
          </For>
          <AgentEditorPanel
            agent={agents().find(
              (agent) => agent.name === editorAgentName() && !agent.builtIn,
            )}
            selectedAgentName={selectedAgent()}
            onSaved={handleAgentSaved}
            onNewMode={() => setEditorAgentName("")}
            onDelete={(name) =>
              setConfirmAction({ kind: "delete-agent", name })
            }
            onError={setError}
          />
          <textarea
            class="mt-2 min-h-28 w-full resize-y rounded-md border border-border bg-background p-3 text-sm"
            placeholder="给选中的 Agent 分配真实模型任务…"
            value={prompt()}
            onInput={(event) => setPrompt(event.currentTarget.value)}
          />
          <button
            class="oc-button oc-button-primary mt-2 w-full"
            disabled={submitting() || !prompt().trim()}
            onClick={() => void submit()}
          >
            {submitting() ? "提交中…" : `运行 ${selectedAgent()}`}
          </button>
        </aside>
        <main
          class="runtime-main agents-runtime-main min-h-0 overflow-auto p-4"
          aria-busy={refreshing()}
        >
          <AgentOrchestrationPanel onCompleted={refresh} onError={setError} />

          <Show when={approvals().length > 0}>
            <section class="mb-4 rounded-md border border-warning/50 bg-card p-3">
              <strong class="text-sm">等待危险操作审批</strong>
              <For each={approvals()}>
                {(approval) => (
                  <article class="mt-2 rounded border border-border bg-background p-2 text-xs">
                    <div class="flex items-center gap-2">
                      <strong>{approval.request.tool}</strong>
                      <span class="text-warning">{approval.request.risk}</span>
                      <span class="flex-1" />
                      <button
                        class="oc-button"
                        onClick={() => void resolveApproval(approval.id, false)}
                      >
                        拒绝
                      </button>
                      <button
                        class="oc-button oc-button-primary"
                        onClick={() => void resolveApproval(approval.id, true)}
                      >
                        批准
                      </button>
                    </div>
                    <p class="mt-1 text-muted-foreground">
                      {approval.request.summary}
                    </p>
                    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>session {approval.sessionId}</span>
                      <Show
                        when={
                          sessions().find(
                            (session) => session.id === approval.sessionId,
                          )?.taskId
                        }
                      >
                        {(taskId) => <span>task {taskId()}</span>}
                      </Show>
                      <span>动作 {approval.request.action}</span>
                      <span
                        classList={{
                          "text-error": approvalRemaining(approval) <= 10,
                        }}
                      >
                        {approvalRemaining(approval)} 秒后过期
                      </span>
                    </div>
                    <Show when={approval.request.paths?.length}>
                      <div class="mt-2 flex flex-wrap gap-1">
                        <For each={approval.request.paths}>
                          {(path) => (
                            <code class="rounded border border-border bg-card px-1.5 py-0.5">
                              {path}
                            </code>
                          )}
                        </For>
                      </div>
                    </Show>
                    <Show when={approval.request.command}>
                      <pre class="mt-2 overflow-auto rounded bg-card p-2 font-mono">
                        {approval.request.command}
                      </pre>
                    </Show>
                  </article>
                )}
              </For>
            </section>
          </Show>

          <Show when={changes().length > 0}>
            <section class="mb-4 rounded-md border border-border bg-card p-3">
              <div class="flex items-center gap-2">
                <strong class="text-sm">Agent 文件修改与回滚</strong>
                <span class="text-xs text-muted-foreground">
                  显示 {Math.min(visibleChanges(), changes().length)} /{" "}
                  {changes().length}
                </span>
              </div>
              <For each={changes().slice(0, visibleChanges())}>
                {(change) => (
                  <details class="mt-2 rounded border border-border bg-background p-2 text-xs">
                    <summary class="cursor-pointer">
                      {change.tool} · {change.path}
                      <Show when={change.rolledBackAt}> · 已回滚</Show>
                    </summary>
                    <div class="mt-1 text-[11px] text-muted-foreground">
                      session {change.sessionId} ·{" "}
                      {new Date(change.createdAt).toLocaleString()}
                    </div>
                    <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono">
                      {change.diff}
                    </pre>
                    <Show when={!change.rolledBackAt}>
                      <button
                        class="oc-button mt-2"
                        onClick={() => rollbackChange(change)}
                      >
                        安全回滚
                      </button>
                    </Show>
                  </details>
                )}
              </For>
              <Show when={visibleChanges() < changes().length}>
                <button
                  class="oc-button mt-3"
                  onClick={() => setVisibleChanges((count) => count + 20)}
                >
                  显示更多变更（剩余 {changes().length - visibleChanges()}）
                </button>
              </Show>
            </section>
          </Show>

          <div class="mb-3 flex flex-wrap items-center gap-2">
            <strong class="text-sm">Agent 会话</strong>
            <span class="text-xs text-muted-foreground">
              有状态模型循环 · 工具结果回灌 · 持久化轨迹
            </span>
            <span class="flex-1" />
            <label
              class="flex items-center gap-2 text-xs"
              for="agent-event-filter"
            >
              事件筛选
              <select
                id="agent-event-filter"
                class="rounded border border-border bg-background px-2 py-1"
                value={eventFilter()}
                onChange={(event) => setEventFilter(event.currentTarget.value)}
              >
                <option value="all">全部</option>
                <option value="tool">工具</option>
                <option value="error">错误</option>
                <option value="context">上下文压缩</option>
              </select>
            </label>
          </div>
          <Show
            when={sessions().length > 0}
            fallback={
              <EmptyState
                title="没有 Agent 会话"
                detail="运行 Agent 后，这里会显示模型轮次、内置工具调用、结果与错误。"
              />
            }
          >
            <For each={sessions()}>
              {(session) => (
                <article class="mb-3 rounded-md border border-border bg-card p-3">
                  <header class="flex flex-wrap items-center gap-2">
                    <Show
                      when={renamingSessionId() === session.id}
                      fallback={
                        <strong class="min-w-0 flex-1 truncate">
                          {session.name ||
                            `${session.agent} · ${session.prompt || "新会话"}`}
                        </strong>
                      }
                    >
                      <label
                        class="flex min-w-0 flex-1 items-center gap-2 text-xs"
                        for={`agent-session-name-${session.id}`}
                      >
                        会话名称
                        <input
                          id={`agent-session-name-${session.id}`}
                          class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
                          value={renameSessionText()}
                          onInput={(event) =>
                            setRenameSessionText(event.currentTarget.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter")
                              void saveSessionName(session.id);
                            if (event.key === "Escape")
                              setRenamingSessionId("");
                          }}
                        />
                        <button
                          class="oc-button"
                          disabled={!renameSessionText().trim()}
                          onClick={() => void saveSessionName(session.id)}
                        >
                          保存
                        </button>
                        <button
                          class="oc-button"
                          onClick={() => setRenamingSessionId("")}
                        >
                          取消
                        </button>
                      </label>
                    </Show>
                    <span class="text-xs text-muted-foreground">
                      {session.status}
                    </span>
                    <Show
                      when={
                        session.status === "pending" ||
                        session.status === "running"
                      }
                      fallback={
                        <>
                          <button
                            class="oc-button"
                            onClick={() => void renameSession(session)}
                          >
                            重命名
                          </button>
                          <button
                            class="oc-button"
                            onClick={() => void branchSession(session.id)}
                          >
                            分支
                          </button>
                          <button
                            class="oc-button"
                            onClick={() => void retrySession(session)}
                          >
                            重试
                          </button>
                          <button
                            class="oc-button text-error"
                            onClick={() => void deleteSession(session.id)}
                          >
                            删除
                          </button>
                        </>
                      }
                    >
                      <button
                        class="oc-button"
                        onClick={() => void cancelSession(session.id)}
                      >
                        中止 Agent
                      </button>
                    </Show>
                  </header>
                  <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{session.id}</span>
                    <Show when={session.taskId}>
                      <span>task {session.taskId}</span>
                    </Show>
                    <Show when={session.parentSessionId}>
                      <span>branch of {session.parentSessionId}</span>
                    </Show>
                    <Show when={session.provider || session.model}>
                      <span>
                        {[session.provider, session.model]
                          .filter(Boolean)
                          .join(" / ")}
                      </span>
                    </Show>
                  </div>
                  <Show when={session.events?.length}>
                    <div class="mt-3 rounded border border-border bg-background p-2">
                      <div class="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>
                          显示 {visibleSessionEvents(session).length} /{" "}
                          {filteredEvents(session.events ?? []).length} 条事件
                        </span>
                        <span class="flex-1" />
                        <Show
                          when={
                            visibleSessionEvents(session).length <
                            filteredEvents(session.events ?? []).length
                          }
                        >
                          <button
                            class="oc-button"
                            onClick={() => showEarlierEvents(session.id)}
                          >
                            加载更早事件
                          </button>
                        </Show>
                      </div>
                      <div class="max-h-44 overflow-auto">
                        <For each={visibleSessionEvents(session)}>
                          {(event) => (
                            <div class="flex gap-2 border-b border-border/50 py-1 text-xs last:border-0">
                              <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                                {new Date(event.timestamp).toLocaleTimeString()}
                              </span>
                              <span
                                classList={{
                                  "text-error":
                                    event.type === "agent_error" ||
                                    event.toolResult?.success === false,
                                }}
                              >
                                {summarizeAgentEvent(event)}
                                <Show when={event.toolResult?.error}>
                                  <span> · {event.toolResult?.error}</span>
                                </Show>
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                  <Show when={liveOutput()[session.id]}>
                    <div class="mt-3 rounded border border-ring/40 bg-background p-3">
                      <div class="mb-2 text-[11px] text-muted-foreground">
                        模型流式输出
                      </div>
                      <pre class="max-h-72 overflow-auto whitespace-pre-wrap text-sm">
                        {liveOutput()[session.id]}
                      </pre>
                    </div>
                  </Show>
                  <Show when={session.error}>
                    <pre class="mt-2 whitespace-pre-wrap text-sm text-error">
                      {session.error}
                    </pre>
                  </Show>
                  <Show when={session.result}>
                    {(result) => (
                      <div class="mt-3 rounded border border-border bg-background p-3">
                        <div class="mb-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                          <span>{result().iterations} 轮</span>
                          <span>{result().toolExecutions} 次工具调用</span>
                          <span>{result().durationMs} ms</span>
                          <span>{result().finishReason}</span>
                        </div>
                        <pre class="max-h-72 overflow-auto whitespace-pre-wrap text-sm">
                          {result().content}
                        </pre>
                      </div>
                    )}
                  </Show>
                </article>
              )}
            </For>
          </Show>

          <div class="mb-3 mt-6 flex items-center gap-2 border-t border-border pt-4">
            <strong class="text-sm">Swarm 队列</strong>
            <span class="text-xs text-muted-foreground">
              调度、并发与任务级状态
            </span>
          </div>
          <Show
            when={tasks().length > 0}
            fallback={
              <EmptyState
                title="没有 Swarm 任务"
                detail="Agent 会话会进入真实 SwarmManager 队列。"
              />
            }
          >
            <For each={tasks()}>
              {(task) => (
                <article class="mb-3 rounded-md border border-border bg-card p-3">
                  <header class="flex items-center gap-2">
                    <strong class="min-w-0 flex-1 truncate">{task.name}</strong>
                    <span class="text-xs text-muted-foreground">
                      {task.status}
                    </span>
                    <Show
                      when={
                        task.status === "pending" || task.status === "running"
                      }
                    >
                      <button
                        class="oc-button"
                        onClick={() => void cancel(task.id)}
                      >
                        取消
                      </button>
                    </Show>
                  </header>
                  <small class="text-muted-foreground">{task.id}</small>
                  <Show when={task.error}>
                    <pre class="mt-2 whitespace-pre-wrap text-sm text-error">
                      {task.error}
                    </pre>
                  </Show>
                  <Show when={task.result !== undefined}>
                    <pre class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs">
                      {formatValue(task.result)}
                    </pre>
                  </Show>
                </article>
              )}
            </For>
          </Show>
        </main>
      </div>
      <Show when={confirmAction()}>
        <div
          class="sc-palette-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !confirmingAction())
              setConfirmAction(null);
          }}
        >
          <section
            class="w-full max-w-md rounded-md border border-border bg-card p-4 shadow-xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="agent-confirm-title"
          >
            <strong id="agent-confirm-title">{confirmActionTitle()}</strong>
            <p class="mt-2 text-sm text-muted-foreground">
              此操作会立即修改持久化状态。继续前请确认目标和影响范围。
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button
                class="oc-button"
                disabled={confirmingAction()}
                onClick={() => setConfirmAction(null)}
              >
                取消
              </button>
              <button
                class="oc-button text-error"
                disabled={confirmingAction()}
                onClick={() => void runConfirmAction()}
              >
                {confirmingAction() ? "处理中…" : "确认操作"}
              </button>
            </div>
          </section>
        </div>
      </Show>
    </section>
  );
};

interface SkillSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean";
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

interface SkillItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  inputSchema?: {
    type?: string;
    properties?: Record<string, SkillSchemaProperty>;
    required?: string[];
  };
}

export const SkillsRuntimeView: Component<RuntimeViewProps> = (props) => {
  const [skills, setSkills] = createSignal<SkillItem[]>([]);
  const [selected, setSelected] = createSignal("");
  const [fieldValues, setFieldValues] = createSignal<
    Record<string, string | boolean>
  >({});
  const [argumentsText, setArgumentsText] = createSignal("{}");
  const [advancedMode, setAdvancedMode] = createSignal(false);
  const [result, setResult] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [running, setRunning] = createSignal(false);

  const selectedSkill = () =>
    skills().find((skill) => skill.name === selected());
  const schemaEntries = () =>
    Object.entries(selectedSkill()?.inputSchema?.properties ?? {});

  const selectSkill = (skill: SkillItem) => {
    setSelected(skill.name);
    const values: Record<string, string | boolean> = {};
    for (const [name, property] of Object.entries(
      skill.inputSchema?.properties ?? {},
    )) {
      values[name] =
        property.type === "boolean"
          ? Boolean(property.default)
          : property.default === undefined
            ? ""
            : String(property.default);
    }
    setFieldValues(values);
    setArgumentsText(JSON.stringify(values, null, 2));
    setAdvancedMode(!skill.inputSchema?.properties);
    setResult("");
    setError("");
  };

  createEffect(() => {
    const target = props.focusTarget;
    if (!target) return;
    const skill = skills().find(
      (item) =>
        item.name.toLocaleLowerCase() === target.value.toLocaleLowerCase(),
    );
    if (skill && selected() !== skill.name) selectSkill(skill);
  });

  const load = async () => {
    setLoading(true);
    try {
      const response = await desktopRequest<{ skills: SkillItem[] }>(
        "skills/list",
      );
      setSkills(response.skills);
      if (response.skills.length) {
        const next =
          response.skills.find((skill) => skill.name === selected()) ??
          response.skills[0];
        selectSkill(next);
      } else {
        setSelected("");
      }
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  const buildSchemaInput = (): Record<string, unknown> => {
    const skill = selectedSkill();
    const properties = skill?.inputSchema?.properties ?? {};
    const required = new Set(skill?.inputSchema?.required ?? []);
    const input: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(properties)) {
      const value = fieldValues()[name];
      if ((value === "" || value === undefined) && required.has(name))
        throw new Error(`参数 ${name} 为必填项`);
      if (value === "" || value === undefined) continue;
      if (property.type === "boolean") input[name] = Boolean(value);
      else if (property.type === "number" || property.type === "integer") {
        const number = Number(value);
        if (!Number.isFinite(number))
          throw new Error(`参数 ${name} 必须是数字`);
        input[name] = property.type === "integer" ? Math.trunc(number) : number;
      } else input[name] = String(value);
    }
    return input;
  };

  const execute = async () => {
    if (!selected()) return;
    setRunning(true);
    setError("");
    try {
      const input = advancedMode()
        ? (() => {
            const parsed = JSON.parse(argumentsText()) as unknown;
            if (!isRecord(parsed)) throw new Error("参数必须是 JSON 对象");
            return parsed;
          })()
        : buildSchemaInput();
      const response = await desktopRequest("tool.execute", {
        name: selected(),
        input,
      });
      setResult(formatValue(response));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRunning(false);
    }
  };

  onMount(() => void load());

  return (
    <section class="oc-runtime-page oc-skills-page flex h-full min-h-0 flex-col">
      <div class="oc-page-body runtime-split skills-runtime grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
        <aside
          class="runtime-sidebar skills-runtime-sidebar overflow-auto border-r border-border p-3"
          aria-busy={loading()}
        >
          <div class="oc-catalog-header">
            <div>
              <span class="oc-context-kicker">Tool catalog</span>
              <strong>Skills</strong>
            </div>
            <button
              class="sc-icon-button"
              disabled={loading()}
              aria-label="刷新 Skills"
              title="刷新 Skills"
              onClick={() => void load()}
            >
              <Icon name="reset" size="small" />
            </button>
          </div>
          <Show
            when={!loading() && skills().length > 0}
            fallback={
              <EmptyState
                title={loading() ? "正在加载 Skills" : "没有可用 Skill"}
                detail={
                  loading()
                    ? "正在读取内置工具与工作区 Skill。"
                    : "请先在工作区安装或启用 Skill。"
                }
              />
            }
          >
            <For each={skills()}>
              {(skill) => (
                <button
                  class="oc-skill-row"
                  data-skill-name={skill.name}
                  classList={{
                    "border-ring bg-muted": selected() === skill.name,
                  }}
                  aria-current={selected() === skill.name ? "page" : undefined}
                  onClick={() => selectSkill(skill)}
                >
                  <strong>/{skill.name}</strong>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {skill.description}
                  </p>
                </button>
              )}
            </For>
          </Show>
        </aside>
        <main
          class="runtime-main skills-runtime-main flex min-h-0 flex-col gap-3 overflow-auto p-4"
          aria-busy={running()}
        >
          <Show
            when={selectedSkill()}
            fallback={
              <EmptyState
                title="选择一个 Skill"
                detail="选择后可配置参数并执行。"
              />
            }
          >
            {(skill) => (
              <>
                <header class="oc-detail-header">
                  <div class="min-w-0 flex-1">
                    <strong>执行 /{skill().name}</strong>
                    <p class="text-xs text-muted-foreground">
                      {skill().description}
                    </p>
                  </div>
                  <Show when={schemaEntries().length > 0}>
                    <button
                      class="oc-button"
                      onClick={() => {
                        const next = !advancedMode();
                        if (next)
                          setArgumentsText(
                            JSON.stringify(buildSchemaInput(), null, 2),
                          );
                        setAdvancedMode(next);
                      }}
                    >
                      {advancedMode() ? "使用表单" : "高级 JSON"}
                    </button>
                  </Show>
                </header>
                <Show
                  when={!advancedMode() && schemaEntries().length > 0}
                  fallback={
                    <label class="block text-xs" for="skill-json-arguments">
                      JSON 参数
                      <textarea
                        id="skill-json-arguments"
                        class="mt-1 h-40 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-sm"
                        aria-describedby="skill-json-help"
                        value={argumentsText()}
                        onInput={(event) =>
                          setArgumentsText(event.currentTarget.value)
                        }
                        spellcheck={false}
                      />
                      <small id="skill-json-help" class="text-muted-foreground">
                        此 Skill 未提供可渲染 schema，或已切换到高级模式。
                      </small>
                    </label>
                  }
                >
                  <div class="grid gap-3 md:grid-cols-2">
                    <For each={schemaEntries()}>
                      {([name, property]) => (
                        <label
                          class="block text-xs"
                          for={`skill-field-${name}`}
                        >
                          {name}
                          <Show
                            when={selectedSkill()?.inputSchema?.required?.includes(
                              name,
                            )}
                          >
                            <span class="text-error"> *</span>
                          </Show>
                          <Show
                            when={property.type === "boolean"}
                            fallback={
                              <Show
                                when={property.enum?.length}
                                fallback={
                                  <input
                                    id={`skill-field-${name}`}
                                    type={
                                      property.type === "number" ||
                                      property.type === "integer"
                                        ? "number"
                                        : "text"
                                    }
                                    class="mt-1 w-full rounded border border-border bg-background px-2 py-1.5"
                                    value={String(fieldValues()[name] ?? "")}
                                    onInput={(event) =>
                                      setFieldValues((current) => ({
                                        ...current,
                                        [name]: event.currentTarget.value,
                                      }))
                                    }
                                  />
                                }
                              >
                                <select
                                  id={`skill-field-${name}`}
                                  class="mt-1 w-full rounded border border-border bg-background px-2 py-1.5"
                                  value={String(fieldValues()[name] ?? "")}
                                  onChange={(event) =>
                                    setFieldValues((current) => ({
                                      ...current,
                                      [name]: event.currentTarget.value,
                                    }))
                                  }
                                >
                                  <option value="">请选择</option>
                                  <For each={property.enum}>
                                    {(option) => (
                                      <option value={String(option)}>
                                        {String(option)}
                                      </option>
                                    )}
                                  </For>
                                </select>
                              </Show>
                            }
                          >
                            <input
                              id={`skill-field-${name}`}
                              type="checkbox"
                              class="ml-2"
                              checked={Boolean(fieldValues()[name])}
                              onChange={(event) =>
                                setFieldValues((current) => ({
                                  ...current,
                                  [name]: event.currentTarget.checked,
                                }))
                              }
                            />
                          </Show>
                          <Show when={property.description}>
                            <small class="mt-1 block text-muted-foreground">
                              {property.description}
                            </small>
                          </Show>
                        </label>
                      )}
                    </For>
                  </div>
                </Show>
                <button
                  class="oc-button oc-button-primary self-start"
                  disabled={running() || !selected()}
                  onClick={() => void execute()}
                >
                  {running() ? "执行中…" : "执行工具"}
                </button>
                <Show when={error()}>
                  <ErrorNotice message={error()} />
                </Show>
                <Show when={result()}>
                  <pre class="min-h-40 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-xs">
                    {result()}
                  </pre>
                </Show>
              </>
            )}
          </Show>
        </main>
      </div>
    </section>
  );
};

interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  status: "connected" | "disconnected" | "error";
  toolCount: number;
  tools: Array<Record<string, unknown>>;
  error?: string;
}

export const McpRuntimeView: Component<RuntimeViewProps> = (props) => {
  const [servers, setServers] = createSignal<McpServer[]>([]);
  const [selectedServer, setSelectedServer] = createSignal("");
  const [selectedTool, setSelectedTool] = createSignal("");
  const [argumentsText, setArgumentsText] = createSignal("{}");
  const [result, setResult] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [callBusy, setCallBusy] = createSignal(false);
  const [activeCallId, setActiveCallId] = createSignal("");

  const selectedMcpTool = () =>
    servers()
      .find((server) => server.id === selectedServer())
      ?.tools.find((tool) => String(tool.name || "") === selectedTool());

  const load = async (sync = false) => {
    setBusy(true);
    try {
      const response = sync
        ? await desktopRequest<{ servers: McpServer[] }>("mcp.sync")
        : await desktopRequest<{ servers: McpServer[] }>("mcp.status");
      setServers(response.servers);
      const selected = response.servers.find(
        (server) => server.id === selectedServer(),
      );
      const toolStillExists = selected?.tools.some(
        (tool) => String(tool.name || "") === selectedTool(),
      );
      if (!selected || selected.status !== "connected" || !toolStillExists) {
        setSelectedServer("");
        setSelectedTool("");
        setArgumentsText("{}");
        setResult("");
      }
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  createEffect(() => {
    const target = props.focusTarget;
    if (!target) return;
    const normalized = target.value.toLocaleLowerCase();
    const server = servers().find(
      (item) =>
        item.id.toLocaleLowerCase() === normalized ||
        item.name.toLocaleLowerCase() === normalized,
    );
    if (!server) return;
    const firstTool = String(server.tools[0]?.name || "");
    if (
      firstTool &&
      (selectedServer() !== server.id || selectedTool() !== firstTool)
    ) {
      setSelectedServer(server.id);
      setSelectedTool(firstTool);
      setArgumentsText("{}");
      setResult("");
    }
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-mcp-server-id="${server.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  });

  const connect = async (serverId: string) => {
    setBusy(true);
    try {
      await desktopRequest("mcp.connect", { serverId }, 120_000);
      await load();
      props.onRuntimeChanged?.();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (serverId: string) => {
    await desktopRequest("mcp.disconnect", { serverId });
    await load();
    props.onRuntimeChanged?.();
  };

  const callTool = async () => {
    if (callBusy() || !selectedServer() || !selectedTool()) return;
    setCallBusy(true);
    setError("");
    setResult("");
    const callId = globalThis.crypto.randomUUID();
    setActiveCallId(callId);
    try {
      const parsed = JSON.parse(argumentsText()) as unknown;
      if (!isRecord(parsed)) throw new Error("MCP 参数必须是 JSON 对象");
      const response = await desktopRequest(
        "mcp.call",
        {
          callId,
          serverId: selectedServer(),
          name: selectedTool(),
          arguments: parsed,
        },
        120_000,
      );
      setResult(formatValue(response));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      if (activeCallId() === callId) setActiveCallId("");
      setCallBusy(false);
    }
  };

  const cancelToolCall = async () => {
    const callId = activeCallId();
    if (!callId) return;
    try {
      await desktopRequest("mcp.cancel", { callId });
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  onMount(() => void load());
  const unsubscribe = subscribeDesktopEvent((event) => {
    if (event === "mcp.status") void load();
  });
  onCleanup(unsubscribe);

  return (
    <section class="oc-runtime-page oc-mcp-page flex h-full min-h-0 flex-col">
      <Show when={error()}>
        <div class="p-3">
          <ErrorNotice message={error()} />
        </div>
      </Show>
      <div class="oc-page-body runtime-split mcp-runtime grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)]">
        <aside class="runtime-sidebar mcp-runtime-sidebar overflow-auto border-r border-border p-3">
          <div class="oc-catalog-header">
            <div>
              <span class="oc-context-kicker">Connected tools</span>
              <strong>MCP Servers</strong>
            </div>
            <button
              class="sc-icon-button"
              disabled={busy()}
              aria-label="同步 MCP 连接"
              title="同步 MCP 连接"
              onClick={() => void load(true)}
            >
              <Icon name="reset" size="small" />
            </button>
          </div>
          <Show
            when={servers().length}
            fallback={
              <EmptyState
                title="没有配置 MCP Server"
                detail="在设置中添加 stdio Server 命令后，可在这里建立真实 SDK 连接。"
              />
            }
          >
            <For each={servers()}>
              {(server) => (
                <article class="oc-mcp-server" data-mcp-server-id={server.id}>
                  <header class="flex items-center gap-2">
                    <strong class="min-w-0 flex-1 truncate">
                      {server.name}
                    </strong>
                    <span class="text-xs">{server.status}</span>
                  </header>
                  <code class="mt-1 block truncate text-xs text-muted-foreground">
                    {server.command} {server.args.join(" ")}
                  </code>
                  <div class="mt-2 flex gap-2">
                    <Show
                      when={server.status === "connected"}
                      fallback={
                        <button
                          class="oc-button"
                          disabled={!server.enabled || busy()}
                          onClick={() => void connect(server.id)}
                        >
                          连接
                        </button>
                      }
                    >
                      <button
                        class="oc-button"
                        onClick={() => void disconnect(server.id)}
                      >
                        断开
                      </button>
                    </Show>
                    <span class="self-center text-xs text-muted-foreground">
                      {server.toolCount} tools
                    </span>
                  </div>
                  <Show when={server.error}>
                    <pre class="mt-2 whitespace-pre-wrap text-xs text-error">
                      {server.error}
                    </pre>
                  </Show>
                  <For each={server.tools}>
                    {(tool) => (
                      <button
                        class="oc-mcp-tool-row"
                        classList={{
                          "border-ring bg-muted":
                            selectedServer() === server.id &&
                            selectedTool() === String(tool.name || ""),
                        }}
                        aria-current={
                          selectedServer() === server.id &&
                          selectedTool() === String(tool.name || "")
                            ? "page"
                            : undefined
                        }
                        onClick={() => {
                          setSelectedServer(server.id);
                          setSelectedTool(String(tool.name || ""));
                          setArgumentsText("{}");
                          setResult("");
                          setError("");
                        }}
                      >
                        {String(tool.name || "")}
                      </button>
                    )}
                  </For>
                </article>
              )}
            </For>
          </Show>
        </aside>
        <main
          class="runtime-main mcp-runtime-main flex min-h-0 flex-col gap-3 p-4"
          aria-busy={callBusy()}
        >
          <Show
            when={selectedTool()}
            fallback={
              <EmptyState
                title="选择一个 MCP 工具"
                detail="调用会通过已连接的官方 MCP Client 发送。"
              />
            }
          >
            <header class="oc-detail-header">
              <div>
                <span class="oc-context-kicker">MCP tool</span>
                <strong>{selectedTool()}</strong>
                <small>{selectedServer()}</small>
              </div>
            </header>
            <SchemaArgumentsEditor
              schema={selectedMcpTool()?.inputSchema}
              value={argumentsText()}
              onChange={setArgumentsText}
              idPrefix="mcp-schema"
            />
            <label class="block text-xs" for="mcp-tool-arguments">
              JSON 参数
              <textarea
                id="mcp-tool-arguments"
                class="mt-1 h-40 w-full rounded-md border border-border bg-background p-3 font-mono text-sm"
                aria-describedby="mcp-tool-help"
                value={argumentsText()}
                onInput={(event) => setArgumentsText(event.currentTarget.value)}
                spellcheck={false}
              />
              <small id="mcp-tool-help" class="text-muted-foreground">
                参数会发送给当前已连接的 MCP Server。
              </small>
            </label>
            <div class="flex gap-2">
              <button
                class="oc-button oc-button-primary"
                disabled={callBusy()}
                onClick={() => void callTool()}
              >
                {callBusy() ? "调用中…" : "调用 MCP 工具"}
              </button>
              <Show when={callBusy()}>
                <button
                  class="oc-button text-error"
                  onClick={() => void cancelToolCall()}
                >
                  停止调用
                </button>
              </Show>
            </div>
            <Show when={result()}>
              <pre class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded border border-border p-3 text-xs">
                {result()}
              </pre>
            </Show>
          </Show>
        </main>
      </div>
    </section>
  );
};

export const BrowserRuntimeView: Component = () => {
  const [url, setUrl] = createSignal("");
  const [error, setError] = createSignal("");
  const [opening, setOpening] = createSignal(false);

  const open = async () => {
    if (!url().trim() || opening()) return;
    setOpening(true);
    setError("");
    try {
      const parsed = new URL(url().trim());
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("只允许 HTTP/HTTPS 地址");
      }
      await openExternal(parsed.toString());
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setOpening(false);
    }
  };

  return (
    <section class="oc-runtime-page oc-browser-page flex h-full min-h-0 flex-col">
      <div class="oc-browser-body flex min-h-0 flex-1 items-center justify-center p-6">
        <div class="oc-browser-launcher w-full max-w-2xl">
          <span class="oc-context-kicker">System browser</span>
          <Icon name="window-cursor" size="large" />
          <h1>打开外部网址</h1>
          <p>
            地址会经过本地 URL 安全策略校验后，在系统默认浏览器中真实打开。
            内网、localhost、凭据 URL 和非 HTTP 协议会被拒绝。
          </p>
          <form
            class="oc-browser-urlbar"
            onSubmit={(event) => {
              event.preventDefault();
              void open();
            }}
          >
            <label class="min-w-0 flex-1 text-sm" for="external-url">
              HTTP/HTTPS 地址
              <input
                id="external-url"
                class="oc-browser-input"
                aria-describedby={
                  error() ? "external-url-error" : "external-url-help"
                }
                aria-invalid={Boolean(error())}
                inputmode="url"
                value={url()}
                onInput={(event) => {
                  setUrl(event.currentTarget.value);
                  setError("");
                }}
                placeholder="https://example.com"
              />
            </label>
            <button
              class="oc-button oc-button-primary"
              disabled={opening() || !url().trim()}
            >
              {opening() ? "打开中…" : "打开"}
            </button>
          </form>
          <small
            id="external-url-help"
            class="mt-2 block text-muted-foreground"
          >
            此页面不嵌入或模拟网页内容。
          </small>
          <Show when={error()}>
            <div id="external-url-error" class="mt-3">
              <ErrorNotice message={error()} />
            </div>
          </Show>
        </div>
      </div>
    </section>
  );
};

interface PublicProviderConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  configured: boolean;
  apiKeyHint: string;
  apiKey?: string | null;
}

interface PublicConfig {
  workspace: string;
  theme: "dark" | "light" | "auto";
  selectedProvider: "openai" | "anthropic" | "kimi";
  providers: Record<"openai" | "anthropic" | "kimi", PublicProviderConfig>;
  mcp: { servers: unknown[] };
  swarm: {
    maxWorkers: number;
    maxConcurrency: number;
    taskTimeoutMs: number;
  };
}

const providerIds = ["openai", "anthropic", "kimi"] as const;

const SETTINGS_SEARCH_INDEX = {
  "settings-general": "工作区 外观 workspace theme 目录 主题",
  "settings-providers":
    "模型 provider api key base url openai anthropic kimi 密钥",
  "settings-swarm": "swarm worker concurrency timeout 并发 编排 超时",
  "settings-mcp": "mcp stdio server json 连接 工具",
} as const;

type SettingsSectionId = keyof typeof SETTINGS_SEARCH_INDEX;

export const SettingsRuntimeView: Component<RuntimeViewProps> = (props) => {
  const [config, setConfig] = createSignal<PublicConfig | null>(null);
  const [baselineConfig, setBaselineConfig] = createSignal<PublicConfig | null>(
    null,
  );
  const [mcpText, setMcpText] = createSignal("[]");
  const [baselineMcpText, setBaselineMcpText] = createSignal("[]");
  const [saving, setSaving] = createSignal(false);
  const [savingMcp, setSavingMcp] = createSignal(false);
  const [error, setError] = createSignal("");
  const [saved, setSaved] = createSignal(false);
  const [settingsQuery, setSettingsQuery] = createSignal("");

  const settingsSectionVisible = (id: SettingsSectionId) => {
    const tokens = settingsQuery()
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) return true;
    const haystack = `${id} ${SETTINGS_SEARCH_INDEX[id]}`.toLocaleLowerCase();
    return tokens.every((token) => haystack.includes(token));
  };
  const visibleSettingsCount = () =>
    (Object.keys(SETTINGS_SEARCH_INDEX) as SettingsSectionId[]).filter(
      settingsSectionVisible,
    ).length;

  const mainDirty = () =>
    JSON.stringify(config()) !== JSON.stringify(baselineConfig());
  const mcpDirty = () => mcpText() !== baselineMcpText();
  const dirty = () => mainDirty() || mcpDirty();

  const load = async () => {
    try {
      const value = await desktopRequest<PublicConfig>("config/get");
      const serversText = JSON.stringify(value.mcp.servers, null, 2);
      setConfig(value);
      setBaselineConfig(structuredClone(value));
      setMcpText(serversText);
      setBaselineMcpText(serversText);
      setError("");
      setSaved(false);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const updateProvider = (
    id: (typeof providerIds)[number],
    update: Partial<PublicProviderConfig>,
  ) => {
    setConfig((current) =>
      current
        ? {
            ...current,
            providers: {
              ...current.providers,
              [id]: { ...current.providers[id], ...update },
            },
          }
        : current,
    );
  };

  const save = async () => {
    const current = config();
    if (!current || saving()) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const providers = Object.fromEntries(
        providerIds.map((id) => [
          id,
          {
            enabled: current.providers[id].enabled,
            baseUrl: current.providers[id].baseUrl,
            model: current.providers[id].model,
            apiKey:
              current.providers[id].apiKey === null
                ? null
                : current.providers[id].apiKey || "",
          },
        ]),
      );
      const next = await desktopRequest<PublicConfig>(
        "config/set",
        {
          workspace: current.workspace,
          theme: current.theme,
          selectedProvider: current.selectedProvider,
          providers,
          swarm: current.swarm,
        },
        120_000,
      );
      setConfig(next);
      setBaselineConfig(structuredClone(next));
      window.starcore?.setTheme(next.theme === "auto" ? "system" : next.theme);
      setSaved(true);
      props.onRuntimeChanged?.();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const saveMcp = async () => {
    if (savingMcp()) return;
    setSavingMcp(true);
    setSaved(false);
    setError("");
    try {
      const servers = JSON.parse(mcpText()) as unknown;
      if (!Array.isArray(servers)) throw new Error("MCP 配置必须是 JSON 数组");
      const next = await desktopRequest<PublicConfig>(
        "config/set",
        { mcp: { servers } },
        120_000,
      );
      const serversText = JSON.stringify(next.mcp.servers, null, 2);
      setConfig((current) =>
        current ? { ...current, mcp: next.mcp } : structuredClone(next),
      );
      setBaselineConfig((current) =>
        current ? { ...current, mcp: next.mcp } : structuredClone(next),
      );
      setMcpText(serversText);
      setBaselineMcpText(serversText);
      setSaved(true);
      props.onRuntimeChanged?.();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSavingMcp(false);
    }
  };

  const revert = () => {
    const baseline = baselineConfig();
    if (!baseline) return;
    setConfig(structuredClone(baseline));
    setMcpText(baselineMcpText());
    setError("");
    setSaved(false);
  };

  const pickWorkspace = async () => {
    setError("");
    setSaved(false);
    try {
      const selected = await chooseWorkspace();
      if (!selected) return;
      const next = await desktopRequest<PublicConfig>("config/set", {
        workspace: selected,
      });
      setConfig((current) =>
        current
          ? { ...current, workspace: next.workspace }
          : structuredClone(next),
      );
      setBaselineConfig((current) =>
        current
          ? { ...current, workspace: next.workspace }
          : structuredClone(next),
      );
      setSaved(true);
      props.onRuntimeChanged?.();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };

  createEffect(() => {
    const hasChanges = dirty();
    props.onDirtyChange?.(hasChanges);
    if (hasChanges) setSaved(false);
  });

  createEffect(() => {
    const target = props.focusTarget;
    if (!target || !config()) return;
    if (!(target.value in SETTINGS_SEARCH_INDEX)) return;
    setSettingsQuery("");
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .getElementById(target.value)
          ?.scrollIntoView({ block: "start" }),
      ),
    );
  });

  onMount(() => {
    void load();
    window.addEventListener("beforeunload", handleBeforeUnload);
  });
  onCleanup(() => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    props.onDirtyChange?.(false);
  });

  return (
    <section class="oc-runtime-page oc-settings-page flex h-full min-h-0 flex-col">
      <div class="oc-settings-layout min-h-0 flex-1">
        <aside class="oc-settings-nav" aria-label="设置分类">
          <div class="oc-settings-nav-intro">
            <span class="oc-context-kicker">Preferences</span>
            <strong>Settings</strong>
            <small>运行时、模型、编排与扩展连接</small>
          </div>
          <label class="oc-settings-search">
            <Icon name="magnifying-glass" size="small" />
            <input
              value={settingsQuery()}
              onInput={(event) => setSettingsQuery(event.currentTarget.value)}
              placeholder="搜索设置"
              aria-label="搜索设置"
              autocomplete="off"
              spellcheck={false}
            />
            <small>{visibleSettingsCount()}</small>
          </label>
          <nav>
            <a
              href="#settings-general"
              classList={{
                "is-filtered-out": !settingsSectionVisible("settings-general"),
              }}
            >
              工作区与外观
            </a>
            <a
              href="#settings-providers"
              classList={{
                "is-filtered-out":
                  !settingsSectionVisible("settings-providers"),
              }}
            >
              模型 Provider
            </a>
            <a
              href="#settings-swarm"
              classList={{
                "is-filtered-out": !settingsSectionVisible("settings-swarm"),
              }}
            >
              Swarm
            </a>
            <a
              href="#settings-mcp"
              classList={{
                "is-filtered-out": !settingsSectionVisible("settings-mcp"),
              }}
            >
              MCP Servers
            </a>
          </nav>
          <div class="oc-settings-privacy">
            API Key 仅写入本地加密存储，不会返回 renderer。
          </div>
        </aside>
        <div class="oc-settings-scroll min-h-0 overflow-auto">
          <div class="oc-settings-content">
            <header class="oc-settings-lead">
              <div>
                <span class="oc-context-kicker">Desktop configuration</span>
                <h1>偏好设置</h1>
                <p>按功能分组调整，不改变各工具页面自身的信息架构。</p>
              </div>
              <div class="oc-settings-actions">
                <button
                  class="oc-button"
                  disabled={!dirty() || saving() || savingMcp()}
                  onClick={revert}
                >
                  放弃更改
                </button>
                <button
                  class="oc-button oc-button-primary"
                  disabled={
                    saving() || savingMcp() || !config() || !mainDirty()
                  }
                  onClick={() => void save()}
                >
                  {saving() ? "保存中…" : "保存主配置"}
                </button>
              </div>
            </header>
            <Show when={error()}>
              <ErrorNotice message={error()} />
            </Show>
            <Show when={saved()}>
              <div class="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
                配置已保存并重新加载运行时。
              </div>
            </Show>
            <Show when={config() && visibleSettingsCount() === 0}>
              <EmptyState
                title="没有匹配的设置"
                detail="尝试 workspace、provider、swarm、MCP 或中文关键词。"
              />
            </Show>
            <Show when={config()}>
              {(value) => (
                <>
                  <section
                    id="settings-general"
                    class="oc-settings-section"
                    classList={{
                      "is-filtered-out":
                        !settingsSectionVisible("settings-general"),
                    }}
                  >
                    <h2 class="font-semibold">工作区与外观</h2>
                    <label class="mt-3 block text-sm">
                      工作区
                      <div class="mt-1 flex gap-2">
                        <input
                          class="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2"
                          value={value().workspace}
                          onInput={(event) =>
                            setConfig({
                              ...value(),
                              workspace: event.currentTarget.value,
                            })
                          }
                        />
                        <button
                          class="oc-button"
                          onClick={() => void pickWorkspace()}
                        >
                          选择并立即应用
                        </button>
                      </div>
                    </label>
                    <label class="mt-3 block text-sm">
                      主题
                      <select
                        class="mt-1 w-full rounded border border-border bg-background px-3 py-2"
                        value={value().theme}
                        onChange={(event) =>
                          setConfig({
                            ...value(),
                            theme: event.currentTarget
                              .value as PublicConfig["theme"],
                          })
                        }
                      >
                        <option value="dark">深色</option>
                        <option value="light">浅色</option>
                        <option value="auto">跟随系统</option>
                      </select>
                    </label>
                  </section>

                  <section
                    id="settings-providers"
                    class="oc-settings-section"
                    classList={{
                      "is-filtered-out":
                        !settingsSectionVisible("settings-providers"),
                    }}
                  >
                    <h2 class="font-semibold">模型 Provider</h2>
                    <label class="mt-3 block text-sm">
                      默认 Provider
                      <select
                        class="mt-1 w-full rounded border border-border bg-background px-3 py-2"
                        value={value().selectedProvider}
                        onChange={(event) =>
                          setConfig({
                            ...value(),
                            selectedProvider: event.currentTarget
                              .value as PublicConfig["selectedProvider"],
                          })
                        }
                      >
                        <For each={providerIds}>
                          {(id) => <option value={id}>{id}</option>}
                        </For>
                      </select>
                    </label>
                    <For each={providerIds}>
                      {(id) => {
                        const provider = () => config()!.providers[id];
                        return (
                          <div class="oc-provider-row">
                            <div class="flex items-center gap-2">
                              <strong class="capitalize">{id}</strong>
                              <span class="text-xs text-muted-foreground">
                                {provider().configured
                                  ? `已配置 ${provider().apiKeyHint}`
                                  : "未配置"}
                              </span>
                              <label class="ml-auto flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={provider().enabled}
                                  onChange={(event) =>
                                    updateProvider(id, {
                                      enabled: event.currentTarget.checked,
                                    })
                                  }
                                />
                                启用
                              </label>
                            </div>
                            <div class="mt-3 grid gap-3 md:grid-cols-2">
                              <label class="text-sm">
                                Base URL
                                <input
                                  class="mt-1 w-full rounded border border-border bg-background px-3 py-2"
                                  value={provider().baseUrl}
                                  onInput={(event) =>
                                    updateProvider(id, {
                                      baseUrl: event.currentTarget.value,
                                    })
                                  }
                                />
                              </label>
                              <label class="text-sm">
                                模型
                                <input
                                  class="mt-1 w-full rounded border border-border bg-background px-3 py-2"
                                  value={provider().model}
                                  onInput={(event) =>
                                    updateProvider(id, {
                                      model: event.currentTarget.value,
                                    })
                                  }
                                  placeholder="必须明确填写模型名称"
                                />
                              </label>
                            </div>
                            <label class="mt-3 block text-sm">
                              API Key
                              <input
                                type="password"
                                class="mt-1 w-full rounded border border-border bg-background px-3 py-2"
                                value={provider().apiKey || ""}
                                onInput={(event) =>
                                  updateProvider(id, {
                                    apiKey: event.currentTarget.value,
                                  })
                                }
                                placeholder={
                                  provider().configured
                                    ? "留空保留已保存密钥"
                                    : "输入 API Key"
                                }
                              />
                            </label>
                            <Show
                              when={
                                provider().configured ||
                                typeof provider().apiKey === "string"
                              }
                            >
                              <div class="mt-2 flex items-center justify-between gap-3 text-xs">
                                <span class="text-muted-foreground">
                                  {provider().apiKey === null
                                    ? "保存配置后将清除此密钥"
                                    : "密钥仅写入加密存储，不会回传到界面"}
                                </span>
                                <button
                                  type="button"
                                  class="oc-button text-error"
                                  onClick={() =>
                                    updateProvider(id, { apiKey: null })
                                  }
                                >
                                  清除密钥
                                </button>
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </section>

                  <section
                    id="settings-swarm"
                    class="oc-settings-section"
                    classList={{
                      "is-filtered-out":
                        !settingsSectionVisible("settings-swarm"),
                    }}
                  >
                    <h2 class="font-semibold">Swarm</h2>
                    <div class="mt-3 grid gap-3 md:grid-cols-3">
                      <label class="text-sm">
                        Workers
                        <input
                          type="number"
                          min="1"
                          max="32"
                          class="mt-1 w-full rounded border border-border bg-background px-3 py-2"
                          value={value().swarm.maxWorkers}
                          onInput={(event) =>
                            setConfig({
                              ...value(),
                              swarm: {
                                ...value().swarm,
                                maxWorkers: Number(event.currentTarget.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label class="text-sm">
                        并发
                        <input
                          type="number"
                          min="1"
                          max="32"
                          class="mt-1 w-full rounded border border-border bg-background px-3 py-2"
                          value={value().swarm.maxConcurrency}
                          onInput={(event) =>
                            setConfig({
                              ...value(),
                              swarm: {
                                ...value().swarm,
                                maxConcurrency: Number(
                                  event.currentTarget.value,
                                ),
                              },
                            })
                          }
                        />
                      </label>
                      <label class="text-sm">
                        任务超时（ms）
                        <input
                          type="number"
                          min="1000"
                          class="mt-1 w-full rounded border border-border bg-background px-3 py-2"
                          value={value().swarm.taskTimeoutMs}
                          onInput={(event) =>
                            setConfig({
                              ...value(),
                              swarm: {
                                ...value().swarm,
                                taskTimeoutMs: Number(
                                  event.currentTarget.value,
                                ),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  </section>

                  <section
                    id="settings-mcp"
                    class="oc-settings-section"
                    classList={{
                      "is-filtered-out":
                        !settingsSectionVisible("settings-mcp"),
                    }}
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <div>
                        <h2 class="font-semibold">MCP stdio Servers</h2>
                        <p class="mt-1 text-xs text-muted-foreground">
                          JSON
                          数组字段：id、name、command、args、cwd、env、enabled。
                        </p>
                      </div>
                      <span class="flex-1" />
                      <button
                        class="oc-button oc-button-primary"
                        disabled={savingMcp() || saving() || !mcpDirty()}
                        onClick={() => void saveMcp()}
                      >
                        {savingMcp() ? "保存 MCP 中…" : "单独保存 MCP"}
                      </button>
                    </div>
                    <label class="mt-3 block text-sm" for="settings-mcp-json">
                      MCP Server JSON
                      <textarea
                        id="settings-mcp-json"
                        class="mt-1 h-64 w-full resize-y rounded border border-border bg-background p-3 font-mono text-xs"
                        aria-describedby="settings-mcp-help"
                        value={mcpText()}
                        onInput={(event) =>
                          setMcpText(event.currentTarget.value)
                        }
                        spellcheck={false}
                      />
                    </label>
                    <small id="settings-mcp-help" class="text-muted-foreground">
                      此区域独立校验和保存，不会阻止 Provider、主题或 Swarm
                      配置保存。
                    </small>
                  </section>
                </>
              )}
            </Show>
          </div>
        </div>
      </div>
    </section>
  );
};
