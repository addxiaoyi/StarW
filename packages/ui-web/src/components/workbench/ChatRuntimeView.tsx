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
import { Icon, type IconName } from "../Icon";
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

type ChatToolMode =
  "terminal" | "files" | "agents" | "skills" | "mcp" | "browser" | "settings";

interface ChatRuntimeViewProps {
  onSelectMode?: (mode: ChatToolMode) => void;
}

type AgentMode = "build" | "plan";
type ChatView = "home" | "session";

const TOOL_LINKS: Array<{ id: ChatToolMode; label: string; icon: IconName }> = [
  { id: "terminal", label: "终端", icon: "terminal" },
  { id: "files", label: "文件", icon: "file-tree" },
  { id: "agents", label: "智能体", icon: "subagent" },
  { id: "skills", label: "技能", icon: "zap" },
  { id: "mcp", label: "MCP", icon: "providers" },
  { id: "browser", label: "浏览器", icon: "window-cursor" },
  { id: "settings", label: "设置", icon: "settings-gear" },
];

const PLAN_MODE_PREFIX =
  "[OpenStar Plan Mode]\nAnalyze the request, inspect relevant context, and produce a concrete implementation plan before making changes. Do not modify files or execute destructive actions unless the user explicitly switches to Build mode.\n\n";

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
  const [view, setView] = createSignal<ChatView>("home");
  const [openTabIds, setOpenTabIds] = createSignal<string[]>([]);
  const [sidePanelOpen, setSidePanelOpen] = createSignal(false);
  let requestSequence = 0;
  let messageList!: HTMLDivElement;
  let composer!: HTMLTextAreaElement;
  let followBottom = true;

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
  const openTabs = createMemo(() =>
    openTabIds()
      .map((id) => sessions().find((session) => session.id === id))
      .filter((session): session is ChatSession => Boolean(session)),
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
    setOpenTabIds((current) =>
      current.filter((id) =>
        result.sessions.some((session) => session.id === id),
      ),
    );
    if (
      activeId() &&
      !result.sessions.some((session) => session.id === activeId())
    ) {
      requestSequence += 1;
      setActiveId("");
      setMessages([]);
      setStreamingText("");
      setView("home");
    }
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

  const createSession = async (name = "New Task") => {
    const result = await desktopRequest<{ session: ChatSession }>(
      "sessions/create",
      { name },
    );
    await loadSessions();
    requestSequence += 1;
    setSessionQuery("");
    setOpenTabIds((current) =>
      current.includes(result.session.id)
        ? current
        : [...current, result.session.id],
    );
    setActiveId(result.session.id);
    setView("session");
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

  const openSession = (sessionId: string) => {
    setOpenTabIds((current) =>
      current.includes(sessionId) ? current : [...current, sessionId],
    );
    setView("session");
    selectSession(sessionId);
  };

  const closeSessionTab = (sessionId: string) => {
    const current = openTabIds();
    const index = current.indexOf(sessionId);
    const remaining = current.filter((id) => id !== sessionId);
    setOpenTabIds(remaining);
    if (activeId() !== sessionId) return;

    const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
    if (next) {
      setView("session");
      selectSession(next);
      return;
    }

    requestSequence += 1;
    setActiveId("");
    setMessages([]);
    setStreamingText("");
    setView("home");
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
      openSession(result.session.id);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  onMount(() => {
    void Promise.allSettled([
      loadSessions(),
      loadConfig(),
      loadWorkspaceContext(),
    ]).then((results) => {
      if (results[0].status === "rejected")
        setError(errorText(results[0].reason));
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
    <section class="oc-v2-shell" data-view={view()}>
      <header class="oc-v2-titlebar" data-slot="opencode-titlebar">
        <button
          type="button"
          class="oc-v2-titlebar-button oc-v2-home-button"
          classList={{ "is-active": view() === "home" }}
          aria-label="主页"
          aria-pressed={view() === "home"}
          onClick={() => setView("home")}
        >
          <Icon name="dot-grid" size="normal" />
        </button>
        <div class="oc-v2-tabs" role="tablist" aria-label="打开的会话">
          <For each={openTabs()}>
            {(session) => (
              <div
                class="oc-v2-tab"
                classList={{
                  "is-active":
                    view() === "session" && activeId() === session.id,
                  "is-busy": busySessionId() === session.id,
                }}
                role="tab"
                aria-selected={
                  view() === "session" && activeId() === session.id
                }
                title={session.name}
                onClick={() => openSession(session.id)}
              >
                <span class="oc-v2-tab-avatar">
                  {workspaceName(workspacePath()).slice(0, 1).toUpperCase()}
                </span>
                <span class="oc-v2-tab-title">{session.name}</span>
                <Show when={busySessionId() === session.id}>
                  <span class="oc-v2-tab-running" aria-label="运行中" />
                </Show>
                <button
                  type="button"
                  class="oc-v2-tab-close"
                  aria-label={`关闭 ${session.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeSessionTab(session.id);
                  }}
                >
                  <Icon name="close-small" size="small" />
                </button>
              </div>
            )}
          </For>
        </div>
        <button
          type="button"
          class="oc-v2-titlebar-button"
          aria-label="新建会话"
          onClick={() => void createSession()}
        >
          <Icon name="plus" size="small" />
        </button>
        <div class="oc-v2-titlebar-spacer" />
        <span
          class="oc-v2-runtime-pill"
          classList={{ "is-running": Boolean(busySessionId()) }}
          title={providerLabel()}
        >
          <span class="oc-v2-runtime-dot" />
          <span>
            {busySessionId() ? "运行中" : providerLabel() || "本地运行时"}
          </span>
        </span>
        <button
          type="button"
          class="oc-v2-titlebar-button"
          aria-label="设置"
          onClick={() => props.onSelectMode?.("settings")}
        >
          <Icon name="settings-gear" size="small" />
        </button>
      </header>

      <Show
        when={view() === "home"}
        fallback={
          <div
            class="oc-v2-session-route"
            classList={{ "is-side-panel-open": sidePanelOpen() }}
          >
            <section class="oc-v2-session-panel">
              <header class="oc-v2-session-header">
                <div class="oc-v2-session-heading">
                  <span>{workspaceName(workspacePath())}</span>
                  <strong>{activeSession()?.name || "新会话"}</strong>
                </div>
                <div class="oc-v2-session-actions">
                  <span
                    class="oc-v2-session-state"
                    classList={{ "is-running": Boolean(busySessionId()) }}
                  >
                    <span />
                    {busySessionId() ? "运行中" : "就绪"}
                  </span>
                  <button
                    type="button"
                    class="oc-v2-icon-button"
                    classList={{ "is-active": sidePanelOpen() }}
                    aria-label="切换文件与审查面板"
                    aria-pressed={sidePanelOpen()}
                    onClick={() => setSidePanelOpen((value) => !value)}
                  >
                    <Icon name="file-tree" size="small" />
                  </button>
                  <button
                    type="button"
                    class="oc-v2-icon-button"
                    aria-label="新建会话"
                    onClick={() => void createSession()}
                  >
                    <Icon name="new-session" size="small" />
                  </button>
                </div>
              </header>

              <Show when={providerError() || error()}>
                <div class="oc-v2-notice-stack">
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
                class="oc-v2-message-scroller"
                onScroll={() => {
                  const gap =
                    messageList.scrollHeight -
                    messageList.scrollTop -
                    messageList.clientHeight;
                  followBottom = gap < 96;
                }}
              >
                <div class="oc-v2-message-column">
                  <Show when={hasMore()}>
                    <button
                      type="button"
                      class="oc-v2-history-button"
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
                      <div class="oc-v2-new-session">
                        <div class="oc-v2-wordmark">
                          <span>
                            <Icon name="models" size="large" />
                          </span>
                          <strong>OpenStar</strong>
                        </div>
                        <p>输入工程任务，开始一个新的智能体会话。</p>
                      </div>
                    }
                  >
                    <For each={messages()}>
                      {(message, index) => (
                        <article
                          class="oc-v2-message"
                          classList={{
                            "is-user": message.role === "user",
                            "is-assistant": message.role === "assistant",
                            "is-system": message.role === "system",
                            "is-optimistic": Boolean(message.optimistic),
                          }}
                        >
                          <header class="oc-v2-message-header">
                            <span class="oc-v2-message-author">
                              {message.role === "assistant"
                                ? "OpenStar"
                                : message.role === "user"
                                  ? "You"
                                  : "System"}
                            </span>
                            <Show when={message.provider || message.model}>
                              <span class="oc-v2-message-model">
                                {message.provider}
                                {message.provider && message.model ? " / " : ""}
                                {message.model}
                              </span>
                            </Show>
                            <Show when={message.created_at}>
                              <time
                                title={new Date(
                                  message.created_at!,
                                ).toLocaleString()}
                              >
                                {new Date(
                                  message.created_at!,
                                ).toLocaleTimeString("zh-CN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                            </Show>
                            <Show when={message.optimistic}>
                              <span class="oc-v2-message-pending">发送中</span>
                            </Show>
                            <span class="oc-v2-message-header-spacer" />
                            <div class="oc-v2-message-actions">
                              <button
                                type="button"
                                class="oc-v2-icon-button"
                                aria-label="复制消息"
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
                                  class="oc-v2-icon-button"
                                  aria-label="编辑此消息"
                                  onClick={() => {
                                    setInput(textOf(message));
                                    requestAnimationFrame(() =>
                                      composer?.focus(),
                                    );
                                  }}
                                >
                                  <Icon name="pencil-line" size="small" />
                                </button>
                              </Show>
                              <Show when={message.role === "assistant"}>
                                <button
                                  type="button"
                                  class="oc-v2-icon-button"
                                  aria-label="重试此回复"
                                  disabled={Boolean(busySessionId())}
                                  onClick={() => retryAt(index())}
                                >
                                  <Icon name="reset" size="small" />
                                </button>
                              </Show>
                              <button
                                type="button"
                                class="oc-v2-icon-button"
                                aria-label="从此消息创建分支"
                                onClick={() => void branchAt(message)}
                              >
                                <Icon name="branch" size="small" />
                              </button>
                            </div>
                          </header>
                          <div class="oc-v2-message-body">
                            <Show
                              when={message.role === "assistant"}
                              fallback={
                                <pre class="oc-v2-user-message">
                                  {textOf(message)}
                                </pre>
                              }
                            >
                              <MarkdownRenderer content={textOf(message)} />
                            </Show>
                          </div>
                          <Show when={message.usage || message.finish_reason}>
                            <footer class="oc-v2-message-meta">
                              <Show when={message.finish_reason}>
                                <span>{message.finish_reason}</span>
                              </Show>
                              <For each={Object.entries(message.usage || {})}>
                                {([key, value]) => (
                                  <span>
                                    {usageLabel(key)}{" "}
                                    {numberFormat.format(value)}
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
                      class="oc-v2-message is-assistant is-streaming"
                      aria-live="polite"
                    >
                      <header class="oc-v2-message-header">
                        <span class="oc-v2-message-author">OpenStar</span>
                        <span class="oc-v2-streaming-indicator">
                          <span />
                          正在响应
                        </span>
                      </header>
                      <div class="oc-v2-message-body">
                        <MarkdownRenderer content={streamingText()} />
                      </div>
                    </article>
                  </Show>
                </div>
              </div>

              <div class="oc-v2-prompt-region">
                <form
                  class="oc-v2-prompt-dock"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendMessage();
                  }}
                >
                  <textarea
                    ref={composer}
                    id="chat-composer"
                    aria-label="发送给当前 Provider"
                    placeholder={
                      busySessionId()
                        ? "当前会话仍在运行…"
                        : agentMode() === "plan"
                          ? "描述目标，代理将先分析并给出计划…"
                          : "Ask anything..."
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
                  <div class="oc-v2-prompt-toolbar">
                    <select
                      class="oc-v2-agent-select"
                      aria-label="Agent mode"
                      value={agentMode()}
                      onChange={(event) =>
                        setAgentMode(event.currentTarget.value as AgentMode)
                      }
                    >
                      <option value="build">Build</option>
                      <option value="plan">Plan</option>
                    </select>
                    <button
                      type="button"
                      class="oc-v2-provider-button"
                      title={providerLabel()}
                      onClick={() => props.onSelectMode?.("settings")}
                    >
                      <Icon name="models" size="small" />
                      <span>{providerLabel() || "Select model"}</span>
                    </button>
                    <span class="oc-v2-prompt-hint">
                      Enter 发送 · Shift Enter 换行
                    </span>
                    <Show
                      when={busySessionId()}
                      fallback={
                        <button
                          type="submit"
                          class="oc-v2-send-button"
                          disabled={!input().trim()}
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
                        onClick={() => void stopGeneration()}
                      >
                        <Icon name="stop" size="small" />
                      </button>
                    </Show>
                  </div>
                </form>
                <p class="oc-v2-prompt-policy">
                  {agentMode() === "plan"
                    ? "Plan 模式先分析和规划，不直接修改文件。"
                    : "Build 模式可修改、执行并验证。"}
                </p>
              </div>
            </section>

            <Show when={sidePanelOpen()}>
              <aside class="oc-v2-side-panel" aria-label="文件与审查">
                <header class="oc-v2-side-panel-header">
                  <div>
                    <span>WORKSPACE</span>
                    <strong>文件与审查</strong>
                  </div>
                  <button
                    type="button"
                    class="oc-v2-icon-button"
                    aria-label="关闭文件与审查面板"
                    onClick={() => setSidePanelOpen(false)}
                  >
                    <Icon name="close-small" size="small" />
                  </button>
                </header>
                <div class="oc-v2-side-panel-body">
                  <section>
                    <h2>当前工作区</h2>
                    <div class="oc-v2-project-card">
                      <span class="oc-v2-project-avatar">
                        {workspaceName(workspacePath())
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                      <span>
                        <strong>{workspaceName(workspacePath())}</strong>
                        <small>{branch() || "local workspace"}</small>
                      </span>
                    </div>
                    <p title={workspacePath()}>{workspacePath()}</p>
                  </section>
                  <section>
                    <h2>工具</h2>
                    <button
                      type="button"
                      onClick={() => props.onSelectMode?.("files")}
                    >
                      <Icon name="file-tree" size="small" />
                      打开文件浏览器
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onSelectMode?.("terminal")}
                    >
                      <Icon name="terminal" size="small" />
                      打开终端
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onSelectMode?.("agents")}
                    >
                      <Icon name="subagent" size="small" />
                      查看智能体
                    </button>
                  </section>
                </div>
              </aside>
            </Show>
          </div>
        }
      >
        <main class="oc-v2-home-surface">
          <div class="oc-v2-home-grid">
            <aside class="oc-v2-project-column" aria-label="项目">
              <div class="oc-v2-home-section-heading">
                <span>项目</span>
              </div>
              <div class="oc-v2-project-list">
                <button
                  type="button"
                  class="oc-v2-project-row is-selected"
                  title={workspacePath()}
                >
                  <span class="oc-v2-project-avatar">
                    {workspaceName(workspacePath()).slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <strong>{workspaceName(workspacePath())}</strong>
                    <small>{branch() || "local workspace"}</small>
                  </span>
                </button>
              </div>
              <div class="oc-v2-home-runtime">
                <span class="oc-v2-runtime-dot" />
                <span>OpenStar 本地运行时</span>
              </div>
              <nav class="oc-v2-utility-nav" aria-label="工作区工具">
                <For each={TOOL_LINKS}>
                  {(item) => (
                    <button
                      type="button"
                      onClick={() => props.onSelectMode?.(item.id)}
                    >
                      <Icon name={item.icon} size="small" />
                      <span>{item.label}</span>
                    </button>
                  )}
                </For>
              </nav>
            </aside>

            <section class="oc-v2-home-sessions" aria-label="最近会话">
              <label class="oc-v2-home-search">
                <Icon name="magnifying-glass" size="small" />
                <input
                  type="search"
                  value={sessionQuery()}
                  placeholder={`搜索 ${workspaceName(workspacePath())} 中的会话`}
                  aria-label="搜索会话"
                  onInput={(event) =>
                    setSessionQuery(event.currentTarget.value)
                  }
                />
                <Show when={sessionQuery()}>
                  <button
                    type="button"
                    aria-label="清除搜索"
                    onClick={() => setSessionQuery("")}
                  >
                    <Icon name="close-small" size="small" />
                  </button>
                </Show>
              </label>
              <div class="oc-v2-home-session-toolbar">
                <span>最近会话</span>
                <button type="button" onClick={() => void createSession()}>
                  <Icon name="edit" size="small" />
                  新建会话
                </button>
              </div>
              <div class="oc-v2-home-session-list">
                <Show
                  when={sessionGroups().length}
                  fallback={
                    <div class="oc-v2-home-empty">
                      <Icon name="speech-bubble" size="large" />
                      <strong>
                        {sessionQuery() ? "没有匹配会话" : "还没有会话"}
                      </strong>
                      <p>
                        {sessionQuery()
                          ? "尝试更短的关键词。"
                          : "创建会话后，它会显示在这里。"}
                      </p>
                      <Show when={!sessionQuery()}>
                        <button
                          type="button"
                          onClick={() => void createSession()}
                        >
                          <Icon name="edit" size="small" />
                          新建会话
                        </button>
                      </Show>
                    </div>
                  }
                >
                  <For each={sessionGroups()}>
                    {(group) => (
                      <section class="oc-v2-home-session-group">
                        <h2>{group.label}</h2>
                        <div>
                          <For each={group.sessions}>
                            {(session) => (
                              <button
                                type="button"
                                class="oc-v2-home-session-row"
                                classList={{
                                  "has-open-tab": openTabIds().includes(
                                    session.id,
                                  ),
                                }}
                                title={session.name}
                                onClick={() => openSession(session.id)}
                              >
                                <span class="oc-v2-session-avatar">
                                  {workspaceName(workspacePath())
                                    .slice(0, 1)
                                    .toUpperCase()}
                                </span>
                                <span class="oc-v2-home-session-title">
                                  {session.name}
                                </span>
                                <span class="oc-v2-home-session-project">
                                  {workspaceName(workspacePath())}
                                </span>
                                <time>
                                  {formatSessionTime(sessionTimestamp(session))}
                                </time>
                              </button>
                            )}
                          </For>
                        </div>
                      </section>
                    )}
                  </For>
                </Show>
              </div>
            </section>
          </div>
        </main>
      </Show>
    </section>
  );
};

export default ChatRuntimeView;
