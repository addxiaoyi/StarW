import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Icon } from "../Icon";
import MarkdownRenderer from "../MarkdownRenderer";
import { desktopRequest, subscribeDesktopEvent } from "../../services/desktop";

interface ChatSession {
  id: string;
  name: string;
  created_at: number;
  updated_at?: number;
}

interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: Array<{ type: "text"; text?: string }>;
  created_at?: number;
  model?: string;
  provider?: string;
  usage?: Record<string, number>;
  finish_reason?: string;
  optimistic?: boolean;
}

interface ChatRuntimeViewProps {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

type AgentMode = "build" | "plan";

const PLAN_MODE_PREFIX =
  "[OpenStar Plan Mode]\nAnalyze the request, inspect relevant context, and produce a concrete implementation plan before making changes. Do not modify files or execute destructive actions unless the user explicitly switches to Build mode.\n\n";

const QUICK_TASKS: Array<{
  title: string;
  detail: string;
  prompt: string;
  mode: AgentMode;
  icon: "search" | "warning" | "circle-check" | "task";
}> = [
  {
    title: "分析仓库",
    detail: "梳理结构、风险与下一步",
    prompt: "分析当前仓库的架构、主要模块、质量风险和最值得优先推进的改进。",
    mode: "plan",
    icon: "search",
  },
  {
    title: "修复问题",
    detail: "定位根因并完成验证",
    prompt:
      "检查当前项目中最明确且可复现的问题，定位根因、修复并运行相关验证。",
    mode: "build",
    icon: "warning",
  },
  {
    title: "补齐测试",
    detail: "覆盖薄弱边界和回归风险",
    prompt: "审查现有测试覆盖，选择一个高风险缺口补充可靠的自动化测试。",
    mode: "build",
    icon: "circle-check",
  },
  {
    title: "规划功能",
    detail: "先形成可执行方案",
    prompt:
      "针对下一项产品功能，先给出用户流程、技术方案、风险和分阶段实施计划。",
    mode: "plan",
    icon: "task",
  },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workspaceName(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) || "OpenStar";
}

function sessionTimestamp(session: ChatSession): number {
  return session.updated_at || session.created_at;
}

function sessionGroupLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return "本周";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
}

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  const group = sessionGroupLabel(timestamp);
  if (group === "今天" || group === "昨天") {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

function usageLabel(key: string): string {
  const known: Record<string, string> = {
    input_tokens: "输入",
    output_tokens: "输出",
    total_tokens: "总计",
    cache_read_tokens: "缓存读取",
    cache_write_tokens: "缓存写入",
  };
  return known[key] || key.replaceAll("_", " ");
}

const numberFormat = new Intl.NumberFormat("zh-CN");

const textOf = (message: ChatMessage) => {
  const text = message.content.map((item) => item.text || "").join("\n");
  return text.startsWith(PLAN_MODE_PREFIX)
    ? text.slice(PLAN_MODE_PREFIX.length)
    : text;
};

const Notice: Component<{ message: string }> = (props) => (
  <div class="oc-chat-notice" role="alert" aria-live="assertive">
    <Icon name="warning" size="small" />
    <span>{props.message}</span>
  </div>
);

const ChatRuntimeView: Component<ChatRuntimeViewProps> = (props) => {
  const [sessions, setSessions] = createSignal<ChatSession[]>([]);
  const [activeId, setActiveId] = createSignal("");
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [input, setInput] = createSignal("");
  const [agentMode, setAgentMode] = createSignal<AgentMode>("build");
  const [busySessionId, setBusySessionId] = createSignal("");
  const [error, setError] = createSignal("");
  const [providerLabel, setProviderLabel] = createSignal("");
  const [providerError, setProviderError] = createSignal("");
  const [workspacePath, setWorkspacePath] = createSignal(".");
  const [branch, setBranch] = createSignal("");
  const [streamingText, setStreamingText] = createSignal("");
  const [hasMore, setHasMore] = createSignal(false);
  const [pageStart, setPageStart] = createSignal(0);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [sessionQuery, setSessionQuery] = createSignal("");
  const [contextPanelOpen, setContextPanelOpen] = createSignal(
    typeof window === "undefined" ? false : window.innerWidth >= 1440,
  );
  let requestSequence = 0;
  let messageList!: HTMLDivElement;
  let composer!: HTMLTextAreaElement;
  let followBottom = true;

  const sidebarOpen = () => props.sidebarOpen !== false;
  const activeSession = createMemo(() =>
    sessions().find((session) => session.id === activeId()),
  );
  const sortedSessions = createMemo(() =>
    [...sessions()].sort(
      (left, right) => sessionTimestamp(right) - sessionTimestamp(left),
    ),
  );
  const filteredSessions = createMemo(() => {
    const query = sessionQuery().trim().toLocaleLowerCase();
    if (!query) return sortedSessions();
    return sortedSessions().filter((session) =>
      session.name.toLocaleLowerCase().includes(query),
    );
  });
  const sessionGroups = createMemo(() => {
    const groups: Array<{ label: string; sessions: ChatSession[] }> = [];
    for (const session of filteredSessions()) {
      const label = sessionGroupLabel(sessionTimestamp(session));
      const current = groups.at(-1);
      if (current?.label === label) current.sessions.push(session);
      else groups.push({ label, sessions: [session] });
    }
    return groups;
  });
  const usageTotals = createMemo(() => {
    const totals = new Map<string, number>();
    for (const message of messages()) {
      for (const [key, value] of Object.entries(message.usage || {})) {
        if (!Number.isFinite(value)) continue;
        totals.set(key, (totals.get(key) || 0) + value);
      }
    }
    return [...totals.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  });
  const messageCount = createMemo(
    () => messages().filter((message) => message.role !== "system").length,
  );
  const userMessageCount = createMemo(
    () => messages().filter((message) => message.role === "user").length,
  );

  const scrollToBottom = () => {
    if (messageList && followBottom)
      messageList.scrollTop = messageList.scrollHeight;
  };

  createEffect(() => {
    messages().length;
    streamingText();
    requestAnimationFrame(scrollToBottom);
  });

  const loadConfig = async () => {
    setProviderError("");
    try {
      const config = await desktopRequest<{
        selectedProvider: string;
        providers: Record<string, { model: string; configured: boolean }>;
      }>("config/get");
      const selected = config.selectedProvider;
      const provider = config.providers[selected];
      setProviderLabel(
        `${selected}${provider?.model ? ` / ${provider.model}` : ""}${
          provider?.configured ? "" : " / 未配置"
        }`,
      );
      if (!provider?.configured)
        setProviderError("当前 Provider 尚未配置 API Key 或模型。");
    } catch (cause) {
      setProviderLabel("Provider 状态不可用");
      setProviderError(errorText(cause));
    }
  };

  const loadWorkspaceContext = async () => {
    try {
      const status = await desktopRequest<{
        workspace?: string;
        branch?: string;
      }>("runtime.status");
      setWorkspacePath(status.workspace || ".");
      setBranch(status.branch || "");
    } catch {
      setWorkspacePath(".");
      setBranch("");
    }
  };

  const loadSessions = async () => {
    const result = await desktopRequest<{ sessions: ChatSession[] }>(
      "sessions/list",
    );
    setSessions(result.sessions);
    if (!activeId() && result.sessions.length)
      setActiveId(result.sessions[0].id);
  };

  interface MessagePage {
    messages: ChatMessage[];
    start: number;
    hasMore: boolean;
  }

  const loadMessages = async (
    sessionId = activeId(),
    options: { before?: number; prepend?: boolean } = {},
  ) => {
    const requestId = ++requestSequence;
    if (!sessionId) {
      if (requestId === requestSequence) {
        setMessages([]);
        setHasMore(false);
        setPageStart(0);
      }
      return;
    }
    const previousHeight = options.prepend ? messageList?.scrollHeight || 0 : 0;
    const result = await desktopRequest<MessagePage>("sessions/list_messages", {
      session_id: sessionId,
      limit: 100,
      ...(options.before === undefined ? {} : { before: options.before }),
    });
    if (requestId !== requestSequence || sessionId !== activeId()) return;
    if (options.prepend) {
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [
          ...result.messages.filter((message) => !known.has(message.id)),
          ...current,
        ];
      });
      requestAnimationFrame(() => {
        if (messageList)
          messageList.scrollTop += messageList.scrollHeight - previousHeight;
      });
    } else {
      setMessages(result.messages);
    }
    setHasMore(result.hasMore);
    setPageStart(result.start);
  };

  const loadOlder = async () => {
    if (!activeId() || !hasMore() || loadingOlder()) return;
    setLoadingOlder(true);
    try {
      await loadMessages(activeId(), {
        before: pageStart(),
        prepend: true,
      });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoadingOlder(false);
    }
  };

  const chooseQuickTask = (task: (typeof QUICK_TASKS)[number]) => {
    setAgentMode(task.mode);
    setInput(task.prompt);
    requestAnimationFrame(() => composer?.focus());
  };

  const createSession = async (name = "New Task") => {
    const result = await desktopRequest<{ session: ChatSession }>(
      "sessions/create",
      { name },
    );
    await loadSessions();
    requestSequence += 1;
    setSessionQuery("");
    setActiveId(result.session.id);
    setMessages([]);
    setStreamingText("");
    requestAnimationFrame(() => composer?.focus());
    return result.session;
  };

  const selectSession = (sessionId: string) => {
    requestSequence += 1;
    setActiveId(sessionId);
    setStreamingText("");
    setError("");
    followBottom = true;
    void loadMessages(sessionId).catch((cause) => setError(errorText(cause)));
  };

  const sendMessage = async (override?: string) => {
    const text = (override ?? input()).trim();
    if (!text || busySessionId()) return;
    const promptText =
      agentMode() === "plan" ? `${PLAN_MODE_PREFIX}${text}` : text;
    let sessionId = activeId();
    setError("");
    setStreamingText("");
    try {
      if (!sessionId) sessionId = (await createSession(text.slice(0, 48))).id;
      setBusySessionId(sessionId);
      if (!override) setInput("");
      setMessages((current) => [
        ...current,
        {
          id: `optimistic-${Date.now()}`,
          role: "user",
          content: [{ type: "text", text }],
          created_at: Date.now(),
          optimistic: true,
        },
      ]);
      followBottom = true;
      await desktopRequest(
        "sessions/prompt",
        {
          session_id: sessionId,
          messages: [
            { role: "user", content: [{ type: "text", text: promptText }] },
          ],
        },
        3_700_000,
      );
      await loadMessages(sessionId);
      await loadSessions();
    } catch (cause) {
      setMessages((current) => current.filter((item) => !item.optimistic));
      setInput((current) => current || text);
      setError(errorText(cause));
      await loadMessages(sessionId).catch(() => undefined);
    } finally {
      if (busySessionId() === sessionId) setBusySessionId("");
    }
  };

  const stopGeneration = async () => {
    const sessionId = busySessionId();
    if (!sessionId) return;
    await desktopRequest("sessions/cancel", { session_id: sessionId }).catch(
      (cause) => setError(errorText(cause)),
    );
  };

  const retryAt = (index: number) => {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const message = messages()[cursor];
      if (message?.role !== "user") continue;
      const text = textOf(message);
      if (text) void sendMessage(text);
      return;
    }
  };

  const branchAt = async (message: ChatMessage) => {
    if (!activeId()) return;
    try {
      const result = await desktopRequest<{ session: ChatSession }>(
        "sessions/branch",
        {
          session_id: activeId(),
          message_id: message.id,
        },
      );
      await loadSessions();
      selectSession(result.session.id);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  onMount(() => {
    void Promise.allSettled([
      loadSessions(),
      loadConfig(),
      loadWorkspaceContext(),
    ]).then(async (results) => {
      if (results[0].status === "rejected")
        setError(errorText(results[0].reason));
      await loadMessages().catch((cause) => setError(errorText(cause)));
    });
  });

  const unsubscribe = subscribeDesktopEvent((event, payload) => {
    if (!isRecord(payload)) return;
    if (
      event === "chat.delta" &&
      payload.sessionId === activeId() &&
      typeof payload.content === "string"
    ) {
      setStreamingText((current) => current + payload.content);
      return;
    }
    if (event === "chat.cancelled" && payload.sessionId === activeId()) {
      setBusySessionId("");
      setError("生成已停止，已接收的流式内容保留在当前视图。");
      return;
    }
    if (
      event === "session.message" &&
      payload.sessionId === activeId() &&
      isRecord(payload.message)
    ) {
      const message = payload.message as unknown as ChatMessage;
      setMessages((current) => {
        const clean =
          message.role === "user"
            ? current.filter((item) => !item.optimistic)
            : current;
        return clean.some((item) => item.id === message.id)
          ? clean
          : [...clean, message];
      });
      if (message.role === "assistant") setStreamingText("");
    }
  });

  onCleanup(() => {
    requestSequence += 1;
    unsubscribe();
  });

  return (
    <section
      class="oc-chat-layout"
      classList={{
        "is-task-sidebar-closed": !sidebarOpen(),
        "is-context-open": contextPanelOpen(),
      }}
    >
      <Show when={sidebarOpen()}>
        <aside class="oc-task-sidebar" aria-label="Agent 任务">
          <header class="oc-task-sidebar-header">
            <div class="oc-workspace-identity" title={workspacePath()}>
              <span class="oc-workspace-avatar">
                {workspaceName(workspacePath()).slice(0, 2).toUpperCase()}
              </span>
              <span class="oc-workspace-copy">
                <strong>{workspaceName(workspacePath())}</strong>
                <small>{branch() || "local workspace"}</small>
              </span>
            </div>
            <button
              type="button"
              class="sc-icon-button"
              aria-label="收起任务侧栏"
              title="收起任务侧栏"
              onClick={() => props.onToggleSidebar?.()}
            >
              <Icon name="chevron-left" size="small" />
            </button>
          </header>

          <div class="oc-task-sidebar-toolbar">
            <label class="oc-session-search">
              <Icon name="search" size="small" />
              <input
                type="search"
                value={sessionQuery()}
                placeholder="搜索任务"
                aria-label="搜索 Agent 任务"
                onInput={(event) => setSessionQuery(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              class="oc-new-task-button"
              onClick={() => void createSession()}
            >
              <Icon name="plus-small" size="small" />
              新建任务
              <kbd>Ctrl N</kbd>
            </button>
          </div>

          <div class="oc-task-groups">
            <Show
              when={sessionGroups().length}
              fallback={
                <div class="oc-task-empty">
                  <Icon name="speech-bubble" size="medium" />
                  <strong>
                    {sessionQuery() ? "没有匹配任务" : "还没有任务"}
                  </strong>
                  <span>
                    {sessionQuery()
                      ? "尝试更短的关键词。"
                      : "新建任务后，会话将保存在本地。"}
                  </span>
                </div>
              }
            >
              <For each={sessionGroups()}>
                {(group) => (
                  <section class="oc-task-group">
                    <h2>{group.label}</h2>
                    <For each={group.sessions}>
                      {(session) => {
                        const isActive = () => activeId() === session.id;
                        const isBusy = () => busySessionId() === session.id;
                        return (
                          <button
                            type="button"
                            class="oc-task-row"
                            classList={{
                              "is-active": isActive(),
                              "is-busy": isBusy(),
                            }}
                            aria-current={isActive() ? "page" : undefined}
                            title={session.name}
                            onClick={() => selectSession(session.id)}
                          >
                            <span class="oc-task-status" aria-hidden="true" />
                            <span class="oc-task-row-copy">
                              <strong>{session.name}</strong>
                              <small>
                                {formatSessionTime(sessionTimestamp(session))}
                              </small>
                            </span>
                            <Show when={isBusy()}>
                              <span class="oc-running-mark">运行中</span>
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </section>
                )}
              </For>
            </Show>
          </div>

          <footer class="oc-task-sidebar-footer">
            <span class="oc-sidebar-runtime-dot" />
            <span>OpenStar 本地运行时</span>
            <Icon name="shield" size="small" />
          </footer>
        </aside>
      </Show>

      <main class="oc-chat-main">
        <section class="oc-session-panel">
          <header class="oc-session-header">
            <div class="oc-session-header-left">
              <Show when={!sidebarOpen()}>
                <button
                  type="button"
                  class="sc-icon-button"
                  aria-label="展开任务侧栏"
                  title="展开任务侧栏"
                  onClick={() => props.onToggleSidebar?.()}
                >
                  <Icon name="layout-left" size="small" />
                </button>
              </Show>
              <div class="oc-session-heading">
                <span class="oc-session-breadcrumb">
                  {workspaceName(workspacePath())}
                  <Icon name="chevron-right" size="small" />
                  Agent
                </span>
                <strong>{activeSession()?.name || "新任务"}</strong>
              </div>
            </div>
            <div class="oc-session-header-actions">
              <span
                class="oc-run-status"
                classList={{ "is-running": Boolean(busySessionId()) }}
              >
                <span />
                {busySessionId() ? "运行中" : "就绪"}
              </span>
              <button
                type="button"
                class="sc-icon-button"
                classList={{ active: contextPanelOpen() }}
                aria-label="切换会话上下文面板"
                aria-pressed={contextPanelOpen()}
                title="会话上下文"
                onClick={() => setContextPanelOpen((value) => !value)}
              >
                <Icon name="file-tree" size="small" />
              </button>
              <button
                type="button"
                class="sc-icon-button"
                aria-label="新建任务"
                title="新建任务"
                onClick={() => void createSession()}
              >
                <Icon name="new-session" size="small" />
              </button>
            </div>
          </header>

          <Show when={providerError() || error()}>
            <div class="oc-notice-stack">
              <Show when={providerError()}>
                <Notice message={providerError()} />
              </Show>
              <Show when={error()}>
                <Notice message={error()} />
              </Show>
            </div>
          </Show>

          <div
            ref={messageList}
            class="oc-message-scroller"
            onScroll={() => {
              const gap =
                messageList.scrollHeight -
                messageList.scrollTop -
                messageList.clientHeight;
              followBottom = gap < 96;
            }}
          >
            <div class="oc-message-column">
              <Show when={hasMore()}>
                <button
                  type="button"
                  class="oc-history-button"
                  disabled={loadingOlder()}
                  onClick={() => void loadOlder()}
                >
                  <Icon name="clock" size="small" />
                  {loadingOlder() ? "正在加载…" : "加载更早消息"}
                </button>
              </Show>

              <Show
                when={messages().length}
                fallback={
                  <div class="oc-chat-welcome">
                    <div class="oc-welcome-mark">
                      <Icon name="models" size="large" />
                    </div>
                    <div>
                      <span class="oc-welcome-eyebrow">
                        OPENCODE-STYLE AGENT WORKSPACE
                      </span>
                      <h1>今天要完成什么？</h1>
                      <p>
                        围绕单个工程任务持续工作。Build 模式负责实施和验证，Plan
                        模式先分析再形成可执行方案。
                      </p>
                    </div>
                    <div class="oc-quick-task-grid">
                      <For each={QUICK_TASKS}>
                        {(task) => (
                          <button
                            type="button"
                            class="oc-quick-task"
                            onClick={() => chooseQuickTask(task)}
                          >
                            <span class="oc-quick-task-icon">
                              <Icon name={task.icon} size="small" />
                            </span>
                            <span>
                              <strong>{task.title}</strong>
                              <small>{task.detail}</small>
                            </span>
                            <span class="oc-quick-task-mode">{task.mode}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                }
              >
                <For each={messages()}>
                  {(message, index) => (
                    <article
                      class="oc-message"
                      classList={{
                        "is-user": message.role === "user",
                        "is-assistant": message.role === "assistant",
                        "is-system": message.role === "system",
                        "is-optimistic": Boolean(message.optimistic),
                      }}
                    >
                      <header class="oc-message-header">
                        <span class="oc-message-author">
                          {message.role === "assistant"
                            ? "OpenStar"
                            : message.role === "user"
                              ? "You"
                              : "System"}
                        </span>
                        <Show when={message.provider || message.model}>
                          <span class="oc-message-model">
                            {message.provider}
                            {message.provider && message.model ? " / " : ""}
                            {message.model}
                          </span>
                        </Show>
                        <Show when={message.created_at}>
                          <time
                            dateTime={new Date(
                              message.created_at!,
                            ).toISOString()}
                            title={new Date(
                              message.created_at!,
                            ).toLocaleString()}
                          >
                            {new Date(message.created_at!).toLocaleTimeString(
                              "zh-CN",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </time>
                        </Show>
                        <Show when={message.optimistic}>
                          <span class="oc-message-pending" role="status">
                            发送中
                          </span>
                        </Show>
                        <span class="oc-message-header-spacer" />
                        <div class="oc-message-actions">
                          <button
                            type="button"
                            class="sc-icon-button"
                            aria-label="复制消息"
                            title="复制消息"
                            onClick={() =>
                              void navigator.clipboard.writeText(
                                textOf(message),
                              )
                            }
                          >
                            <Icon name="copy" size="small" />
                          </button>
                          <Show when={message.role === "user"}>
                            <button
                              type="button"
                              class="sc-icon-button"
                              aria-label="编辑此消息"
                              title="编辑"
                              onClick={() => {
                                setInput(textOf(message));
                                requestAnimationFrame(() => composer?.focus());
                              }}
                            >
                              <Icon name="pencil-line" size="small" />
                            </button>
                          </Show>
                          <Show when={message.role === "assistant"}>
                            <button
                              type="button"
                              class="sc-icon-button"
                              aria-label="重试此回复"
                              title="重试"
                              disabled={Boolean(busySessionId())}
                              onClick={() => retryAt(index())}
                            >
                              <Icon name="reset" size="small" />
                            </button>
                          </Show>
                          <button
                            type="button"
                            class="sc-icon-button"
                            aria-label="从此消息创建分支"
                            title="创建分支"
                            onClick={() => void branchAt(message)}
                          >
                            <Icon name="branch" size="small" />
                          </button>
                        </div>
                      </header>
                      <div class="oc-message-body">
                        <Show
                          when={message.role === "assistant"}
                          fallback={
                            <pre class="oc-user-message-text">
                              {textOf(message)}
                            </pre>
                          }
                        >
                          <MarkdownRenderer content={textOf(message)} />
                        </Show>
                      </div>
                      <Show when={message.usage || message.finish_reason}>
                        <footer class="oc-message-meta">
                          <Show when={message.finish_reason}>
                            <span>{message.finish_reason}</span>
                          </Show>
                          <For each={Object.entries(message.usage || {})}>
                            {([key, value]) => (
                              <span>
                                {usageLabel(key)} {numberFormat.format(value)}
                              </span>
                            )}
                          </For>
                        </footer>
                      </Show>
                    </article>
                  )}
                </For>
              </Show>

              <Show when={streamingText()}>
                <article
                  class="oc-message is-assistant is-streaming"
                  aria-live="polite"
                >
                  <header class="oc-message-header">
                    <span class="oc-message-author">OpenStar</span>
                    <span class="oc-streaming-indicator">
                      <span />
                      正在响应
                    </span>
                  </header>
                  <div class="oc-message-body">
                    <MarkdownRenderer content={streamingText()} />
                  </div>
                </article>
              </Show>
            </div>
          </div>

          <div class="oc-composer-dock">
            <form
              class="oc-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <label class="sr-only" for="chat-composer">
                发送给当前 Provider
              </label>
              <textarea
                ref={composer}
                id="chat-composer"
                aria-label="发送给当前 Provider"
                placeholder={
                  busySessionId()
                    ? "当前任务仍在运行…"
                    : agentMode() === "plan"
                      ? "描述目标，代理将先分析并给出实施计划…"
                      : "描述需要代理完成、测试并验证的工程任务…"
                }
                value={input()}
                onInput={(event) => setInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.isComposing
                  ) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <div class="oc-composer-toolbar">
                <div class="oc-mode-switch" aria-label="Agent execution mode">
                  <button
                    type="button"
                    classList={{ active: agentMode() === "build" }}
                    aria-pressed={agentMode() === "build"}
                    onClick={() => setAgentMode("build")}
                  >
                    <Icon name="code" size="small" />
                    Build
                  </button>
                  <button
                    type="button"
                    classList={{ active: agentMode() === "plan" }}
                    aria-pressed={agentMode() === "plan"}
                    onClick={() => setAgentMode("plan")}
                  >
                    <Icon name="task" size="small" />
                    Plan
                  </button>
                </div>
                <span class="oc-provider-chip" title={providerLabel()}>
                  <Icon name="models" size="small" />
                  {providerLabel() || "Provider"}
                </span>
                <span class="oc-composer-hint">
                  Enter 发送 · Shift Enter 换行
                </span>
                <Show
                  when={busySessionId()}
                  fallback={
                    <button
                      type="submit"
                      class="oc-send-button"
                      disabled={!input().trim()}
                      aria-label="发送消息"
                    >
                      <Icon name="arrow-up" size="small" />
                    </button>
                  }
                >
                  <button
                    type="button"
                    class="oc-stop-button"
                    onClick={() => void stopGeneration()}
                  >
                    <Icon name="stop" size="small" />
                    停止
                  </button>
                </Show>
              </div>
            </form>
            <p class="oc-composer-policy">
              {agentMode() === "plan"
                ? "Plan 模式仅分析和规划，不直接修改文件。"
                : "Build 模式可实施修改、运行命令并完成验证。"}
            </p>
          </div>
        </section>
      </main>

      <Show when={contextPanelOpen()}>
        <aside class="oc-context-panel" aria-label="会话上下文">
          <header class="oc-context-header">
            <div>
              <span>CONTEXT</span>
              <strong>会话上下文</strong>
            </div>
            <button
              type="button"
              class="sc-icon-button"
              aria-label="关闭会话上下文"
              onClick={() => setContextPanelOpen(false)}
            >
              <Icon name="close-small" size="small" />
            </button>
          </header>

          <div class="oc-context-scroll">
            <section class="oc-context-section">
              <h2>当前任务</h2>
              <div class="oc-context-task-card">
                <span class="oc-context-task-icon">
                  <Icon name="task" size="normal" />
                </span>
                <span>
                  <strong>{activeSession()?.name || "尚未创建任务"}</strong>
                  <small>
                    {activeSession()
                      ? new Date(
                          sessionTimestamp(activeSession()!),
                        ).toLocaleString("zh-CN")
                      : "发送第一条消息时自动创建"}
                  </small>
                </span>
              </div>
              <div class="oc-context-stats">
                <span>
                  <strong>{messageCount()}</strong>
                  消息
                </span>
                <span>
                  <strong>{userMessageCount()}</strong>
                  轮任务
                </span>
                <span>
                  <strong>{agentMode() === "build" ? "Build" : "Plan"}</strong>
                  模式
                </span>
              </div>
            </section>

            <section class="oc-context-section">
              <h2>工作区</h2>
              <dl class="oc-context-list">
                <div>
                  <dt>项目</dt>
                  <dd title={workspacePath()}>
                    {workspaceName(workspacePath())}
                  </dd>
                </div>
                <div>
                  <dt>分支</dt>
                  <dd>{branch() || "未检测"}</dd>
                </div>
                <div>
                  <dt>模型</dt>
                  <dd title={providerLabel()}>{providerLabel() || "未配置"}</dd>
                </div>
              </dl>
            </section>

            <Show when={usageTotals().length}>
              <section class="oc-context-section">
                <h2>Token 使用</h2>
                <dl class="oc-context-list">
                  <For each={usageTotals()}>
                    {([key, value]) => (
                      <div>
                        <dt>{usageLabel(key)}</dt>
                        <dd>{numberFormat.format(value)}</dd>
                      </div>
                    )}
                  </For>
                </dl>
              </section>
            </Show>

            <section class="oc-context-section">
              <h2>快捷操作</h2>
              <div class="oc-context-actions">
                <button type="button" onClick={() => void createSession()}>
                  <Icon name="new-session" size="small" />
                  新建任务
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAgentMode("plan");
                    requestAnimationFrame(() => composer?.focus());
                  }}
                >
                  <Icon name="task" size="small" />
                  切换到 Plan
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAgentMode("build");
                    requestAnimationFrame(() => composer?.focus());
                  }}
                >
                  <Icon name="code" size="small" />
                  切换到 Build
                </button>
              </div>
            </section>

            <section class="oc-context-section">
              <h2>快捷键</h2>
              <dl class="oc-shortcut-list">
                <div>
                  <dt>发送消息</dt>
                  <dd>
                    <kbd>Enter</kbd>
                  </dd>
                </div>
                <div>
                  <dt>输入换行</dt>
                  <dd>
                    <kbd>Shift</kbd>
                    <kbd>Enter</kbd>
                  </dd>
                </div>
                <div>
                  <dt>命令面板</dt>
                  <dd>
                    <kbd>Ctrl</kbd>
                    <kbd>K</kbd>
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </aside>
      </Show>
    </section>
  );
};

export default ChatRuntimeView;
