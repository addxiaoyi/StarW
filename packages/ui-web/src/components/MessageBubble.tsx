import { Component, For, Show, createSignal } from "solid-js";
import type { Message } from "../types";
import { Icon } from "./Icon";
import MarkdownRenderer from "./MarkdownRenderer";
import ResultCard, { type ResultCardData } from "./ResultCard";
import ToolCallBlock, { type ToolCallData } from "./ToolCallBlock";

interface Props {
  message: Message;
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function parseResultCard(content: string): ResultCardData | null {
  const match = content.match(/^<!--RESULT_CARD:({[\s\S]*})-->$/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as ResultCardData;
  } catch {
    return null;
  }
}

function parseToolCalls(content: string): { toolCalls: ToolCallData[]; cleanContent: string } {
  const toolCalls: ToolCallData[] = [];
  const regex = /<!--TOOL_CALLS:([\s\S]*?)-->/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") {
            toolCalls.push(item as ToolCallData);
          }
        }
      }
    } catch {
      // ignore malformed markers
    }
  }

  const cleanContent = content.replace(/<!--TOOL_CALLS:([\s\S]*?)-->/g, "").trim();
  return { toolCalls, cleanContent };
}

const MessageBubble: Component<Props> = (props) => {
  const isUser = () => props.message.role === "user";
  const resultCard = () => parseResultCard(props.message.content);
  const parsedToolCalls = () => parseToolCalls(props.message.content);
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div class={`flex gap-3 ${isUser() ? "flex-row-reverse" : ""} oc-animate-fade-in`}>
      <div
        class={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs ${
          isUser()
            ? "bg-primary text-primary-foreground"
            : "bg-gradient-to-br from-primary to-[var(--oc-info)] text-primary-foreground"
        }`}
      >
        {isUser() ? (
          <Icon name="settings-gear" size="small" />
        ) : (
          <Icon name="sparkle-2" size="small" />
        )}
      </div>

      <div class={`max-w-[85%] ${isUser() ? "items-end" : "items-start"} flex flex-col`}>
        <div
          class={`rounded-2xl px-4 py-3 ${
            isUser() ? "oc-message-user" : "oc-message-assistant"
          }`}
        >
          <Show
            when={isUser()}
            fallback={
              <Show
                when={resultCard()}
                fallback={
                  <>
                    <Show when={parsedToolCalls().toolCalls.length > 0}>
                      <div class="space-y-1 mb-2">
                        <For each={parsedToolCalls().toolCalls}>
                          {(tool) => <ToolCallBlock data={tool} />}
                        </For>
                      </div>
                    </Show>
                    <MarkdownRenderer content={parsedToolCalls().cleanContent} />
                  </>
                }
              >
                {(data) => <ResultCard data={data()} />}
              </Show>
            }
          >
            <div class="text-sm whitespace-pre-wrap leading-relaxed">
              {props.message.content || (
                <span class="inline-flex items-center gap-1 h-5">
                  <span class="w-1.5 h-1.5 rounded-full bg-current oc-typing-dot" />
                  <span class="w-1.5 h-1.5 rounded-full bg-current oc-typing-dot" />
                  <span class="w-1.5 h-1.5 rounded-full bg-current oc-typing-dot" />
                </span>
              )}
            </div>
          </Show>
        </div>

        <div class="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
          <span>{formatTime(props.message.timestamp)}</span>

          <Show when={props.message.status === "error"}>
            <span class="text-destructive">生成失败</span>
          </Show>

          <Show when={!isUser() && props.message.content}>
            <button
              onClick={handleCopy}
              class="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              title="复制内容"
            >
              <Icon name={copied() ? "check-small" : "copy"} size="small" />
              {copied() ? "已复制" : "复制"}
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
