import {
  type Component,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { Icon } from "../Icon";
import { desktopRequest } from "../../services/desktop";
import {
  type ComposerCommandId,
  type ComposerFileContext,
  findComposerCommand,
} from "./chat-composer-model";
import {
  isGeneratedWorkspaceEntry,
  parentWorkspacePath,
} from "./runtime-view-utils";

type SidePanelTab = "context" | "files" | "review";

interface SidePanelFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

interface SidePanelChange {
  id: string;
  sessionId: string;
  tool: string;
  path: string;
  createdAt: number;
  diff: string;
  rolledBackAt?: number;
}

interface ChatSessionSidePanelProps {
  workspacePath: string;
  branch: string;
  sessionId: string;
  files: ComposerFileContext[];
  command?: ComposerCommandId;
  onFilesChange: (files: ComposerFileContext[]) => void;
  onClose: () => void;
}

const formatBytes = (bytes?: number) => {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const ChatSessionSidePanel: Component<ChatSessionSidePanelProps> = (props) => {
  const [tab, setTab] = createSignal<SidePanelTab>("context");
  const [currentPath, setCurrentPath] = createSignal(".");
  const [entries, setEntries] = createSignal<SidePanelFileEntry[]>([]);
  const [changes, setChanges] = createSignal<SidePanelChange[]>([]);
  const [filesLoading, setFilesLoading] = createSignal(false);
  const [reviewLoading, setReviewLoading] = createSignal(false);
  const [fileError, setFileError] = createSignal("");
  const [reviewError, setReviewError] = createSignal("");

  const selectedPaths = createMemo(
    () => new Set(props.files.map((file) => file.path)),
  );
  const visibleEntries = createMemo(() =>
    entries().filter(
      (entry) => !isGeneratedWorkspaceEntry(entry.name, currentPath()),
    ),
  );
  const sessionChanges = createMemo(() =>
    props.sessionId
      ? changes().filter((change) => change.sessionId === props.sessionId)
      : [],
  );

  const loadFiles = async (requested = currentPath()) => {
    setFilesLoading(true);
    setFileError("");
    try {
      const result = await desktopRequest<{
        path: string;
        entries: SidePanelFileEntry[];
      }>("files/list", { path: requested });
      setCurrentPath(result.path || ".");
      setEntries(result.entries);
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setFilesLoading(false);
    }
  };

  const loadReview = async () => {
    setReviewLoading(true);
    setReviewError("");
    try {
      const result = await desktopRequest<{ changes: SidePanelChange[] }>(
        "changes/list",
      );
      setChanges(result.changes);
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReviewLoading(false);
    }
  };

  const toggleFile = (entry: SidePanelFileEntry) => {
    if (entry.type === "directory") {
      void loadFiles(entry.path);
      return;
    }
    const selected = selectedPaths().has(entry.path);
    props.onFilesChange(
      selected
        ? props.files.filter((file) => file.path !== entry.path)
        : [...props.files, { path: entry.path, name: entry.name }],
    );
  };

  onMount(() => {
    void loadFiles(".");
    void loadReview();
  });

  return (
    <aside class="oc-v2-side-panel" aria-label="会话上下文、文件与审查">
      <header class="oc-v2-side-panel-header">
        <div>
          <span>WORKSPACE</span>
          <strong>{props.workspacePath}</strong>
        </div>
        <button
          type="button"
          class="oc-v2-icon-button"
          aria-label="关闭会话侧面板"
          onClick={props.onClose}
        >
          <Icon name="close-small" size="small" />
        </button>
      </header>

      <nav class="oc-v2-side-panel-tabs" aria-label="会话侧面板">
        <button
          type="button"
          classList={{ "is-active": tab() === "context" }}
          onClick={() => setTab("context")}
        >
          Context
          <Show when={props.files.length}>
            <span>{props.files.length}</span>
          </Show>
        </button>
        <button
          type="button"
          classList={{ "is-active": tab() === "files" }}
          onClick={() => setTab("files")}
        >
          Files
        </button>
        <button
          type="button"
          classList={{ "is-active": tab() === "review" }}
          onClick={() => {
            setTab("review");
            void loadReview();
          }}
        >
          Review
          <Show when={sessionChanges().length}>
            <span>{sessionChanges().length}</span>
          </Show>
        </button>
      </nav>

      <div class="oc-v2-side-panel-body">
        <Show when={tab() === "context"}>
          <section class="oc-v2-side-pane">
            <div class="oc-v2-project-card">
              <span class="oc-v2-project-avatar">
                {props.workspacePath
                  .replaceAll("\\", "/")
                  .split("/")
                  .filter(Boolean)
                  .at(-1)
                  ?.slice(0, 2)
                  .toUpperCase() || "OS"}
              </span>
              <span>
                <strong>
                  {props.workspacePath
                    .replaceAll("\\", "/")
                    .split("/")
                    .filter(Boolean)
                    .at(-1) || "OpenStar"}
                </strong>
                <small>{props.branch || "local workspace"}</small>
              </span>
            </div>

            <div class="oc-v2-side-section-heading">
              <span>Prompt context</span>
            </div>
            <Show
              when={props.command || props.files.length}
              fallback={
                <div class="oc-v2-side-empty">
                  <strong>没有附加上下文</strong>
                  <p>从 Files 选择文件，或在输入框使用 @ 引用。</p>
                </div>
              }
            >
              <Show when={findComposerCommand(props.command)}>
                {(command) => (
                  <div class="oc-v2-side-context-row">
                    <Icon name="sparkle-2" size="small" />
                    <span>
                      <strong>/{command().id}</strong>
                      <small>{command().description}</small>
                    </span>
                  </div>
                )}
              </Show>
              <For each={props.files}>
                {(file) => (
                  <div class="oc-v2-side-context-row" title={file.path}>
                    <Icon name="file" size="small" />
                    <span>
                      <strong>{file.name}</strong>
                      <small>{file.path}</small>
                    </span>
                    <button
                      type="button"
                      aria-label={`移除 ${file.name}`}
                      onClick={() =>
                        props.onFilesChange(
                          props.files.filter((item) => item.path !== file.path),
                        )
                      }
                    >
                      <Icon name="close-small" size="small" />
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </section>
        </Show>

        <Show when={tab() === "files"}>
          <section class="oc-v2-side-pane is-files">
            <div class="oc-v2-side-file-toolbar">
              <button
                type="button"
                disabled={currentPath() === "." || filesLoading()}
                onClick={() =>
                  void loadFiles(parentWorkspacePath(currentPath()))
                }
              >
                上级
              </button>
              <code title={currentPath()}>{currentPath()}</code>
              <button
                type="button"
                aria-label="刷新侧面板文件"
                disabled={filesLoading()}
                onClick={() => void loadFiles()}
              >
                <Icon name="reset" size="small" />
              </button>
            </div>
            <Show when={fileError()}>
              <div class="oc-v2-side-error" role="alert">
                {fileError()}
              </div>
            </Show>
            <Show
              when={!filesLoading()}
              fallback={<div class="oc-v2-side-loading">正在读取文件…</div>}
            >
              <div class="oc-v2-side-file-list">
                <For each={visibleEntries()}>
                  {(entry) => (
                    <button
                      type="button"
                      class="oc-v2-side-file-row"
                      classList={{
                        "is-directory": entry.type === "directory",
                        "is-selected": selectedPaths().has(entry.path),
                      }}
                      aria-pressed={
                        entry.type === "file"
                          ? selectedPaths().has(entry.path)
                          : undefined
                      }
                      onClick={() => toggleFile(entry)}
                    >
                      <Icon
                        name={entry.type === "directory" ? "folder" : "file"}
                        size="small"
                      />
                      <span>
                        <strong>{entry.name}</strong>
                        <small>
                          {entry.type === "directory"
                            ? "目录"
                            : formatBytes(entry.size)}
                        </small>
                      </span>
                      <Show
                        when={
                          entry.type === "file" &&
                          selectedPaths().has(entry.path)
                        }
                      >
                        <em>已引用</em>
                      </Show>
                    </button>
                  )}
                </For>
                <Show when={!visibleEntries().length}>
                  <div class="oc-v2-side-empty">
                    <strong>目录为空</strong>
                    <p>此目录没有可显示的文件。</p>
                  </div>
                </Show>
              </div>
            </Show>
          </section>
        </Show>

        <Show when={tab() === "review"}>
          <section class="oc-v2-side-pane is-review">
            <div class="oc-v2-side-section-heading">
              <span>Current session changes</span>
              <button
                type="button"
                aria-label="刷新当前会话变更"
                disabled={reviewLoading()}
                onClick={() => void loadReview()}
              >
                <Icon name="reset" size="small" />
              </button>
            </div>
            <Show when={reviewError()}>
              <div class="oc-v2-side-error" role="alert">
                {reviewError()}
              </div>
            </Show>
            <Show
              when={!reviewLoading()}
              fallback={<div class="oc-v2-side-loading">正在读取变更…</div>}
            >
              <Show
                when={sessionChanges().length}
                fallback={
                  <div class="oc-v2-side-empty">
                    <strong>
                      {props.sessionId
                        ? "当前会话没有文件变更"
                        : "草稿尚未产生变更"}
                    </strong>
                    <p>工具修改文件后，真实 diff 会显示在这里。</p>
                  </div>
                }
              >
                <For each={sessionChanges()}>
                  {(change) => (
                    <details class="oc-v2-side-review-row">
                      <summary>
                        <span>
                          <strong>{change.path}</strong>
                          <small>
                            {change.tool} ·{" "}
                            {new Date(change.createdAt).toLocaleTimeString(
                              "zh-CN",
                            )}
                          </small>
                        </span>
                        <Show when={change.rolledBackAt}>
                          <em>已回滚</em>
                        </Show>
                      </summary>
                      <pre>{change.diff}</pre>
                    </details>
                  )}
                </For>
              </Show>
            </Show>
          </section>
        </Show>
      </div>
    </aside>
  );
};

export default ChatSessionSidePanel;
