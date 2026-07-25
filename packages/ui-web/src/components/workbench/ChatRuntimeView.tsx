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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const textOf = (message: ChatMessage) =>
  message.content.map((item) => item.text || "").join("\n");

const Notice: Component<{ message: string }> = (props) => (
  <div
    class="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
    role="alert"
    aria-live="assertive"
  >
    {props.message}
  </div>
);

const ChatRuntimeView: Component = () => {
  const [sessions, setSessions] = createSignal<ChatSession[]>([]);
  const [activeId, setActiveId] = createSignal("");
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [input, setInput] = createSignal("");
  const [busySessionId, setBusySessionId] = createSignal("");
  const [error, setError] = createSignal("");
  const [providerLabel, setProviderLabel] = createSignal("");
  const [providerError, setProviderError] = createSignal("");
  const [streamingText, setStreamingText] = createSignal("");
  const [hasMore, setHasMore] = createSignal(false);
  const [pageStart, setPageStart] = createSignal(0);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  let requestSequence = 0;
  let messageList!: HTMLDivElement;
  let followBottom = true;

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

  const createSession = async (name = "New Session") => {
    const result = await desktopRequest<{ session: ChatSession }>(
      "sessions/create",
      { name },
    );
    await loadSessions();
    requestSequence += 1;
    setActiveId(result.session.id);
    setMessages([]);
    setStreamingText("");
    return result.session;
  };

  const sendMessage = async (override?: string) => {
    const text = (override ?? input()).trim();
    if (!text || busySessionId()) return;
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
          messages: [{ role: "user", content: [{ type: "text", text }] }],
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
      setActiveId(result.session.id);
      await loadMessages(result.session.id);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  onMount(() => {
    void Promise.allSettled([loadSessions(), loadConfig()]).then(
      async (results) => {
        if (results[0].status === "rejected")
          setError(errorText(results[0].reason));
        await loadMessages().catch((cause) => setError(errorText(cause)));
      },
    );
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
    <section class="runtime-split chat-runtime grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)] bg-background">
      <aside class="runtime-sidebar flex min-h-0 flex-col border-r border-border">
        <header class="flex items-center justify-between border-b border-border px-3 py-2">
          <strong class="text-sm">模型会话</strong>
          <button
            class="sc-icon-button"
            aria-label="新建 Chat 会话"
            title="新建会话"
            onClick={() => void createSession()}
          >
            <Icon name="plus-small" size="small" />
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-auto">
          <For each={sessions()}>
            {(session) => (
              <button
                class="block w-full border-b border-border/50 px-3 py-2 text-left"
                classList={{ "bg-muted": activeId() === session.id }}
                aria-current={activeId() === session.id ? "page" : undefined}
                title={session.name}
                onClick={() => {
                  setActiveId(session.id);
                  setStreamingText("");
                  void loadMessages(session.id);
                }}
              >
                <strong class="block truncate text-sm">{session.name}</strong>
                <small class="text-muted-foreground">
                  {new Date(
                    session.updated_at || session.created_at,
                  ).toLocaleString()}
                </small>
              </button>
            )}
          </For>
        </div>
      </aside>

      <main class="runtime-main flex min-h-0 flex-col">
        <header class="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <span class="text-sm font-medium">Chat</span>
          <span
            class="min-w-0 truncate text-xs text-muted-foreground"
            title={providerLabel()}
          >
            {providerLabel()}
          </span>
        </header>
        <Show when={providerError()}>
          <div class="px-3 pt-3">
            <Notice message={providerError()} />
          </div>
        </Show>
        <Show when={error()}>
          <div class="px-3 pt-3">
            <Notice message={error()} />
          </div>
        </Show>

        <div
          ref={messageList}
          class="min-h-0 flex-1 space-y-3 overflow-auto p-4"
          onScroll={() => {
            const gap =
              messageList.scrollHeight -
              messageList.scrollTop -
              messageList.clientHeight;
            followBottom = gap < 96;
          }}
        >
          <Show when={hasMore()}>
            <button
              class="oc-button mx-auto block"
              disabled={loadingOlder()}
              onClick={() => void loadOlder()}
            >
              {loadingOlder() ? "加载中…" : "加载更早消息"}
            </button>
          </Show>

          <Show
            when={messages().length}
            fallback={
              <div class="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                <strong class="text-foreground">开始一个真实模型会话</strong>
                <span class="max-w-lg text-sm">
                  回复直接来自设置中选定的 Provider。
                </span>
              </div>
            }
          >
            <For each={messages()}>
              {(message, index) => (
                <article
                  class="group max-w-3xl rounded-lg border border-border p-3"
                  classList={{
                    "ml-auto bg-accent/10": message.role === "user",
                    "bg-card": message.role !== "user",
                    "opacity-70": Boolean(message.optimistic),
                  }}
                >
                  <header class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <strong class="text-foreground">{message.role}</strong>
                    <Show when={message.optimistic}>
                      <span role="status">发送中…</span>
                    </Show>
                    <Show when={message.provider || message.model}>
                      <span>
                        {message.provider} {message.model}
                      </span>
                    </Show>
                    <Show when={message.created_at}>
                      <time
                        dateTime={new Date(message.created_at!).toISOString()}
                        title={new Date(message.created_at!).toLocaleString()}
                      >
                        {new Date(message.created_at!).toLocaleTimeString()}
                      </time>
                    </Show>
                    <span class="flex-1" />
                    <button
                      class="sc-icon-button"
                      aria-label="复制消息"
                      title="复制消息"
                      onClick={() =>
                        void navigator.clipboard.writeText(textOf(message))
                      }
                    >
                      <Icon name="copy" size="small" />
                    </button>
                    <Show when={message.role === "user"}>
                      <button
                        class="sc-icon-button"
                        aria-label="编辑此消息"
                        title="编辑"
                        onClick={() => setInput(textOf(message))}
                      >
                        <Icon name="pencil-line" size="small" />
                      </button>
                    </Show>
                    <Show when={message.role === "assistant"}>
                      <button
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
                      class="sc-icon-button"
                      aria-label="从此消息创建分支"
                      title="创建分支"
                      onClick={() => void branchAt(message)}
                    >
                      <Icon name="branch" size="small" />
                    </button>
                  </header>
                  <Show
                    when={message.role === "assistant"}
                    fallback={
                      <pre class="whitespace-pre-wrap font-sans text-sm">
                        {textOf(message)}
                      </pre>
                    }
                  >
                    <MarkdownRenderer content={textOf(message)} />
                  </Show>
                  <Show when={message.usage || message.finish_reason}>
                    <footer class="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                      <Show when={message.finish_reason}>
                        <span>finish: {message.finish_reason}</span>
                      </Show>
                      <For each={Object.entries(message.usage || {})}>
                        {([key, value]) => (
                          <span>
                            {key}: {value}
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
              class="max-w-3xl rounded-lg border border-ring/40 bg-card p-3"
              aria-live="polite"
              aria-atomic="false"
            >
              <header class="mb-2 text-xs text-muted-foreground">
                <strong class="text-foreground">assistant</strong> · streaming
              </header>
              <MarkdownRenderer content={streamingText()} />
            </article>
          </Show>
        </div>

        <form
          class="flex gap-2 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <label class="sr-only" for="chat-composer">
            发送给当前 Provider
          </label>
          <textarea
            id="chat-composer"
            class="min-h-20 flex-1 resize-y rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-ring"
            aria-label="发送给当前 Provider"
            placeholder={
              busySessionId()
                ? "可以继续草拟下一条消息…"
                : "发送给当前 Provider…"
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
          <Show
            when={busySessionId()}
            fallback={
              <button
                class="oc-button oc-button-primary self-end"
                disabled={!input().trim()}
              >
                发送
              </button>
            }
          >
            <button
              type="button"
              class="oc-button self-end"
              onClick={() => void stopGeneration()}
            >
              <Icon name="stop" size="small" />
              停止
            </button>
          </Show>
        </form>
      </main>
    </section>
  );
};

export default ChatRuntimeView;
