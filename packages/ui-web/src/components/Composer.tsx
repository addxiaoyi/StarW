import { Component, createSignal, Show, For, onMount, onCleanup, createMemo, createResource } from "solid-js";
import { Icon, type IconName } from "./Icon";
import SlashPopover from "./SlashPopover";
import { useSlashCommands, type SlashCommand } from "../hooks/useSlashCommands";
import { listRegistryAgents, listFiles, type FileEntry, type AcpSkillItem } from "../services/acp";

export interface ComposerAttachment {
  name: string;
  content: string;
}

export interface ComposerOptions {
  model?: string;
  attachments?: ComposerAttachment[];
  agent?: string;
  contextPaths?: string[];
  imageNames?: string[];
}

interface Props {
  onSend: (content: string, options: ComposerOptions) => void;
  onExecuteSkill?: (skillId: string, args: string) => void;
  onSetMode?: (mode: string) => void;
  disabled?: boolean;
  placeholder?: string;
  sessionId?: string;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  icon: IconName;
  description: string;
}

const MODELS: ModelInfo[] = [
  { id: "gpt-4o-mini", name: "GPT-4o mini", provider: "OpenAI", icon: "openai", description: "快速、高性价比的多模态模型" },
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", icon: "openai", description: "OpenAI 旗舰多模态模型" },
  { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", provider: "Anthropic", icon: "anthropic", description: "均衡性能与成本的 Claude 模型" },
  { id: "claude-3-opus-latest", name: "Claude 3 Opus", provider: "Anthropic", icon: "anthropic", description: "Anthropic 最强推理模型" },
  { id: "deepseek-chat", name: "DeepSeek V3", provider: "DeepSeek", icon: "deepseek", description: "国产开源大模型" },
  { id: "qwen-turbo", name: "Qwen Turbo", provider: "Qwen", icon: "qwen", description: "阿里云通义千问快速版" },
];

const HISTORY_KEY = (sessionId: string) => `openstar-prompt-history:${sessionId}`;
const MAX_HISTORY = 50;

function loadHistory(sessionId: string | undefined): string[] {
  if (!sessionId) return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY(sessionId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveHistory(sessionId: string | undefined, entries: string[]) {
  if (!sessionId) return;
  try {
    localStorage.setItem(HISTORY_KEY(sessionId), JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // ignore
  }
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function getFilePreviewUrl(file: File): string {
  return URL.createObjectURL(file);
}

const Composer: Component<Props> = (props) => {
  const [input, setInput] = createSignal("");
  const [focused, setFocused] = createSignal(false);
  const [modelOpen, setModelOpen] = createSignal(false);
  const [modelQuery, setModelQuery] = createSignal("");
  const [selectedModel, setSelectedModel] = createSignal(MODELS[0]);
  const [slashOpen, setSlashOpen] = createSignal(false);
  const [slashQuery, setSlashQuery] = createSignal("");
  const [slashSelected, setSlashSelected] = createSignal(0);
  const [attachments, setAttachments] = createSignal<File[]>([]);
  const [imagePreviews, setImagePreviews] = createSignal<Map<number, string>>(new Map());
  const [dragOver, setDragOver] = createSignal(false);
  const [atOpen, setAtOpen] = createSignal(false);
  const [atQuery, setAtQuery] = createSignal("");
  const [atSelected, setAtSelected] = createSignal(0);
  const [atMode, setAtMode] = createSignal<"all" | "agent" | "file">("all");
  const [historyIndex, setHistoryIndex] = createSignal(-1);
  const [historyEntries, setHistoryEntries] = createSignal<string[]>([]);
  let modelRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let dragCounter = 0;

  const [agents] = createResource(async () => {
    try {
      return await listRegistryAgents();
    } catch {
      return [];
    }
  });

  const [fileEntries] = createResource(async () => {
    try {
      return await listFiles(".");
    } catch {
      return [];
    }
  });

  const allCommands = useSlashCommands();
  const slashCommands = createMemo<SlashCommand[]>(() => {
    const q = slashQuery().toLowerCase();
    const items = allCommands();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.trigger.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        (c.description?.toLowerCase().includes(q) ?? false),
    );
  });

  const slashActive = () => slashOpen() && input().startsWith("/");
  const atActive = () => atOpen();

  onMount(() => {
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("openstar:close-popovers", closePopovers);
    if (props.sessionId) {
      setHistoryEntries(loadHistory(props.sessionId));
    }
  });

  onCleanup(() => {
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("openstar:close-popovers", closePopovers);
    imagePreviews().forEach((url) => URL.revokeObjectURL(url));
  });

  const closePopovers = () => {
    setModelOpen(false);
    setSlashOpen(false);
    setAtOpen(false);
  };

  const handleDocumentClick = (e: MouseEvent) => {
    if (modelRef && !modelRef.contains(e.target as Node)) {
      setModelOpen(false);
    }
    if (atOpen() && !(e.target as HTMLElement).closest("[data-at-popover]")) {
      setAtOpen(false);
    }
  };

  const parseSkillCommand = (value: string): { skillId: string; args: string } | null => {
    if (!value.startsWith("/")) return null;
    const rest = value.slice(1);
    const match = rest.match(/^(\S+)(?:\s+(.*))?$/s);
    if (!match) return null;
    return { skillId: match[1], args: match[2] ?? "" };
  };

  const readFileAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });

  const extractMentions = (value: string): { text: string; agent?: string; contextPaths: string[] } => {
    const contextPaths: string[] = [];
    let agent: string | undefined;
    const seenAgents = new Set<string>();
    const seenPaths = new Set<string>();

    const text = value
      .split(/\s+/)
      .map((token) => {
        if (token.startsWith("@/") && token.length > 2) {
          const path = token.slice(1);
          if (!seenPaths.has(path)) {
            seenPaths.add(path);
            contextPaths.push(path);
          }
          return "";
        }
        if (token.startsWith("@") && token.length > 1 && !token.includes("/")) {
          const id = token.slice(1);
          if (!seenAgents.has(id)) {
            seenAgents.add(id);
            agent = id;
          }
          return "";
        }
        return token;
      })
      .filter(Boolean)
      .join(" ");

    return { text, agent, contextPaths };
  };

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    const value = input().trim();
    const files = attachments();
    if ((!value && files.length === 0) || props.disabled) return;

    const skillCmd = parseSkillCommand(value);
    if (skillCmd && props.onExecuteSkill) {
      props.onExecuteSkill(skillCmd.skillId, skillCmd.args.trim());
      setInput("");
      setSlashOpen(false);
      setAtOpen(false);
      addToHistory(value);
      return;
    }

    const loadedAttachments: ComposerAttachment[] = [];
    for (const file of files) {
      if (isImageFile(file)) {
        loadedAttachments.push({ name: file.name, content: `[图片附件: ${file.name}]` });
        continue;
      }
      try {
        const content = await readFileAsText(file);
        loadedAttachments.push({ name: file.name, content });
      } catch {
        loadedAttachments.push({ name: file.name, content: "[无法读取文件内容]" });
      }
    }

    const { text, agent, contextPaths } = extractMentions(value);
    const imageNames = files.filter(isImageFile).map((f) => f.name);

    props.onSend(text, {
      model: selectedModel().id,
      attachments: loadedAttachments,
      agent,
      contextPaths,
      imageNames,
    });

    setInput("");
    setAttachments([]);
    setSlashOpen(false);
    setAtOpen(false);
    addToHistory(value);
  };

  const addToHistory = (value: string) => {
    if (!value.trim()) return;
    const entries = historyEntries();
    if (entries[0] === value.trim()) return;
    const next = [value.trim(), ...entries].slice(0, MAX_HISTORY);
    setHistoryEntries(next);
    saveHistory(props.sessionId, next);
    setHistoryIndex(-1);
  };

  const applyHistory = (direction: "up" | "down") => {
    const entries = historyEntries();
    if (entries.length === 0) return false;

    if (direction === "up") {
      if (historyIndex() < entries.length - 1) {
        const nextIndex = historyIndex() + 1;
        setHistoryIndex(nextIndex);
        setInput(entries[nextIndex] ?? "");
        return true;
      }
      return false;
    }

    if (historyIndex() > 0) {
      const nextIndex = historyIndex() - 1;
      setHistoryIndex(nextIndex);
      setInput(entries[nextIndex] ?? "");
      return true;
    }

    if (historyIndex() === 0) {
      setHistoryIndex(-1);
      setInput("");
      return true;
    }

    return false;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (atActive()) {
      const items = atItems();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtSelected((i) => (items.length ? (i + 1) % items.length : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtSelected((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[atSelected()];
        if (item) handleAtSelect(item);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAtOpen(false);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const item = items[0];
        if (item) handleAtSelect(item);
        return;
      }
    }

    if (slashActive()) {
      const items = slashCommands();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelected((i) => (items.length ? (i + 1) % items.length : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelected((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = slashCommands()[slashSelected()];
        if (cmd) handleSlashSelect(cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const form = (e.target as HTMLTextAreaElement).closest("form");
      if (form) form.requestSubmit();
      return;
    }

    // Cmd/Ctrl+Enter also sends
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const form = (e.target as HTMLTextAreaElement).closest("form");
      if (form) form.requestSubmit();
      return;
    }

    if (e.key === "ArrowUp" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const target = e.target as HTMLTextAreaElement;
      if (target.selectionStart === 0 && target.selectionEnd === 0) {
        if (applyHistory("up")) {
          e.preventDefault();
        }
      }
      return;
    }

    if (e.key === "ArrowDown" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const target = e.target as HTMLTextAreaElement;
      if (target.selectionStart === input().length && target.selectionEnd === input().length) {
        if (applyHistory("down")) {
          e.preventDefault();
        }
      }
      return;
    }
  };

  const handleInput = (value: string) => {
    setInput(value);
    setHistoryIndex(-1);

    if (value.startsWith("/")) {
      const query = value.slice(1).split(/\s/)[0] ?? "";
      setSlashQuery(query);
      setSlashOpen(true);
      setSlashSelected(0);
      setAtOpen(false);
      return;
    }

    const cursor = textareaRef?.selectionStart ?? value.length;
    const beforeCursor = value.slice(0, cursor);
    const atMatch = beforeCursor.match(/@([^\s]*)$/);

    if (atMatch) {
      const rawQuery = atMatch[1] ?? "";
      setAtQuery(rawQuery);
      setAtOpen(true);
      setAtSelected(0);
      if (rawQuery.startsWith("/")) {
        setAtMode("file");
      } else {
        setAtMode("all");
      }
    } else {
      setAtOpen(false);
    }

    setSlashOpen(false);
  };

  const handleSlashSelect = (cmd: SlashCommand) => {
    if (cmd.source === "system") {
      setInput("");
      setSlashOpen(false);
      if (cmd.id === "terminal" || cmd.id === "canvas" || cmd.id === "browser") {
        props.onSetMode?.(cmd.id);
      }
      return;
    }

    setInput(`/${cmd.trigger} `);
    setSlashOpen(false);
    textareaRef?.focus();
  };

  const currentModel = () => MODELS.find((m) => m.id === selectedModel().id) ?? MODELS[0];

  const filteredModels = createMemo(() => {
    const q = modelQuery().trim().toLowerCase();
    if (!q) return MODELS;
    return MODELS.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q),
    );
  });

  const groupedModels = createMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const model of filteredModels()) {
      const list = map.get(model.provider) ?? [];
      list.push(model);
      map.set(model.provider, list);
    }
    return Array.from(map.entries());
  });

  const providerColor = (provider: string) => {
    switch (provider) {
      case "OpenAI":
        return "text-success";
      case "Anthropic":
        return "text-warning";
      case "DeepSeek":
        return "text-info";
      case "Qwen":
        return "text-accent";
      default:
        return "text-muted-foreground";
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const current = attachments();
    const next = [...current];
    const previews = new Map(imagePreviews());
    for (const file of Array.from(files)) {
      const index = next.length;
      next.push(file);
      if (isImageFile(file)) {
        previews.set(index, getFilePreviewUrl(file));
      }
    }
    setAttachments(next);
    setImagePreviews(previews);
  };

  const removeAttachment = (index: number) => {
    const file = attachments()[index];
    if (file && isImageFile(file)) {
      const url = imagePreviews().get(index);
      if (url) URL.revokeObjectURL(url);
    }
    const next = attachments().filter((_, i) => i !== index);
    const previews = new Map<number, string>();
    next.forEach((f, i) => {
      if (isImageFile(f)) {
        const url = imagePreviews().get(i < index ? i : i + 1);
        if (url) previews.set(i, url);
      }
    });
    setAttachments(next);
    setImagePreviews(previews);
  };

  const handleFileInputChange = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    addFiles(target.files);
    target.value = "";
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragCounter++;
    if (e.dataTransfer?.types.includes("Files")) {
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      setDragOver(false);
      dragCounter = 0;
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    dragCounter = 0;
    setDragOver(false);
    addFiles(e.dataTransfer?.files ?? null);
  };

  const filteredAgents = createMemo<AcpSkillItem[]>(() => {
    const q = atQuery().toLowerCase();
    const list = agents() ?? [];
    if (!q || atMode() === "file") return list;
    return list.filter((a) => a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  });

  const filteredFiles = createMemo<FileEntry[]>(() => {
    const q = atQuery().toLowerCase();
    const list = fileEntries() ?? [];
    if (atMode() === "agent") return [];
    if (!q) return list.slice(0, 20);
    return list.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 20);
  });

  type AtItem =
    | { type: "agent"; id: string; name: string; description?: string }
    | { type: "file"; path: string; name: string }
    | { type: "folder"; path: string; name: string };

  const atItems = createMemo<AtItem[]>(() => {
    const items: AtItem[] = [];
    if (atMode() !== "file") {
      items.push(...filteredAgents().map((a) => ({ type: "agent" as const, id: a.id, name: a.name, description: a.description })));
    }
    if (atMode() !== "agent") {
      items.push(
        ...filteredFiles().map((f) => ({
          type: (f.type === "directory" ? "folder" : "file") as "folder" | "file",
          path: f.path,
          name: f.name,
        })),
      );
    }
    return items;
  });

  const insertAtMention = (insertion: string) => {
    const value = input();
    const cursor = textareaRef?.selectionStart ?? value.length;
    const beforeCursor = value.slice(0, cursor);
    const afterCursor = value.slice(cursor);
    const atMatch = beforeCursor.match(/@[^\s]*$/);
    if (!atMatch) {
      setInput(`${beforeCursor}${insertion} ${afterCursor}`);
      return;
    }
    const newBefore = beforeCursor.slice(0, atMatch.index) + insertion;
    setInput(`${newBefore} ${afterCursor}`);
    requestAnimationFrame(() => {
      const pos = newBefore.length + 1;
      textareaRef?.setSelectionRange(pos, pos);
      textareaRef?.focus();
    });
  };

  const handleAtSelect = (item: AtItem) => {
    if (item.type === "agent") {
      insertAtMention(`@${item.id}`);
    } else {
      insertAtMention(`@${item.path}`);
    }
    setAtOpen(false);
    setAtQuery("");
    setAtSelected(0);
  };

  const openAtContext = () => {
    const value = input();
    const cursor = textareaRef?.selectionStart ?? value.length;
    const newValue = `${value.slice(0, cursor)}@${value.slice(cursor)}`;
    setInput(newValue);
    setAtQuery("");
    setAtMode("all");
    setAtOpen(true);
    setAtSelected(0);
    requestAnimationFrame(() => {
      const pos = cursor + 1;
      textareaRef?.setSelectionRange(pos, pos);
      textareaRef?.focus();
    });
  };

  return (
    <div
      class="border-t border-border px-4 py-3 shrink-0 bg-background"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <form onSubmit={handleSubmit} class="max-w-3xl mx-auto relative">
        <Show when={slashActive()}>
          <SlashPopover
            commands={slashCommands()}
            selectedIndex={slashSelected()}
            onSelect={handleSlashSelect}
            onHover={setSlashSelected}
          />
        </Show>

        <Show when={atActive()}>
          <div
            data-at-popover
            class="absolute inset-x-0 bottom-full mb-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-card shadow-xl z-50 py-1.5"
          >
            <Show
              when={atItems().length > 0}
              fallback={
                <div class="px-3 py-6 text-center text-sm text-muted-foreground">未找到匹配的 agent 或文件</div>
              }
            >
              <For each={atItems()}>
                {(item, index) => (
                  <button
                    type="button"
                    onClick={() => handleAtSelect(item)}
                    onMouseEnter={() => setAtSelected(index())}
                    class={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors hover:bg-muted ${
                      index() === atSelected() ? "bg-muted" : ""
                    }`}
                  >
                    {item.type === "agent" ? (
                      <>
                        <Icon name="subagent" size="normal" class="text-info shrink-0" />
                        <span class="flex-1 min-w-0">
                          <span class="block truncate text-foreground">@{item.id}</span>
                          {item.description && (
                            <span class="block text-xs text-muted-foreground truncate">{item.description}</span>
                          )}
                        </span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider bg-info/10 text-info">
                          agent
                        </span>
                      </>
                    ) : (
                      <>
                        <Icon name={item.type === "folder" ? "folder" : "file"} size="normal" class="text-muted-foreground shrink-0" />
                        <span class="flex-1 min-w-0 truncate text-foreground">@{item.path}</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider bg-muted text-muted-foreground">
                          {item.type}
                        </span>
                      </>
                    )}
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <div
          class={`flex flex-col rounded-2xl border transition-all overflow-hidden ${
            dragOver()
              ? "border-accent ring-2 ring-accent/20 bg-accent/5"
              : focused()
                ? "border-ring ring-2 ring-ring/20 bg-background shadow-lg"
                : "border-input bg-card shadow-sm"
          }`}
        >
          <textarea
            ref={textareaRef}
            value={input()}
            onInput={(e) => handleInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={props.placeholder || "输入消息，按 Enter 发送，Shift+Enter 换行，/ 触发命令，@ 引用上下文..."}
            disabled={props.disabled}
            class="flex-1 px-4 pt-3 pb-2 bg-transparent resize-none outline-none text-sm min-h-[52px] max-h-48"
            rows={1}
          />

          <Show when={attachments().length > 0}>
            <div class="flex flex-wrap gap-2 px-4 pb-2">
              <For each={attachments()}>
                {(file, index) => (
                  <Show
                    when={isImageFile(file)}
                    fallback={
                      <div class="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-muted border border-border text-xs text-foreground max-w-full">
                        <Icon name="file" size="small" class="text-muted-foreground shrink-0" />
                        <span class="truncate max-w-[160px]">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(index())}
                          class="oc-icon-button w-5 h-5"
                          title="移除"
                        >
                          <Icon name="close-small" size="small" />
                        </button>
                      </div>
                    }
                  >
                    <div class="relative group w-16 h-16 rounded-md overflow-hidden border border-border bg-muted">
                      <img
                        src={imagePreviews().get(index())}
                        alt={file.name}
                        class="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeAttachment(index())}
                        class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-card border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted"
                        title="移除"
                      >
                        <Icon name="close-small" size="small" />
                      </button>
                    </div>
                  </Show>
                )}
              </For>
            </div>
          </Show>

          <div class="flex items-center justify-between px-2 pb-2">
            <div class="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                class="hidden"
                onChange={handleFileInputChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef?.click()}
                class="oc-icon-button"
                title="上传文件"
              >
                <Icon name="arrow-down-to-line" size="small" />
              </button>
              <button
                type="button"
                onClick={openAtContext}
                class="oc-icon-button"
                title="@ 上下文"
              >
                <Icon name="comment" size="small" />
              </button>
              <button type="button" class="oc-icon-button" title="MCP 工具">
                <Icon name="mcp" size="small" />
              </button>

              <div class="relative ml-1" ref={modelRef}>
                <button
                  type="button"
                  onClick={() => setModelOpen(!modelOpen())}
                  class={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${
                    modelOpen() ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon name={currentModel().icon} size="small" class={providerColor(currentModel().provider)} />
                  <span class="truncate max-w-[120px]">{currentModel().name}</span>
                  <Icon name="chevron-down" size="small" />
                </button>

                <Show when={modelOpen()}>
                  <div class="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-border bg-popover shadow-2xl py-2 z-50 overflow-hidden">
                    <div class="px-3 pb-2 border-b border-border">
                      <div class="flex items-center justify-between mb-2">
                        <span class="text-xs font-semibold text-foreground">选择模型</span>
                        <button
                          type="button"
                          onClick={() => setModelOpen(false)}
                          class="oc-icon-button oc-icon-button-sm"
                          title="关闭"
                        >
                          <Icon name="close-small" size="small" />
                        </button>
                      </div>
                      <div class="oc-input-wrapper">
                        <input
                          value={modelQuery()}
                          onInput={(e) => setModelQuery(e.currentTarget.value)}
                          placeholder="搜索模型或提供商..."
                          class="oc-input oc-input-sm py-1.5 text-xs"
                          autocomplete="off"
                        />
                        <Show when={modelQuery()}>
                          <button
                            type="button"
                            onClick={() => setModelQuery("")}
                            class="oc-input-clear"
                            title="清除"
                          >
                            <Icon name="close-small" size="small" />
                          </button>
                        </Show>
                      </div>
                    </div>

                    <div class="max-h-72 overflow-y-auto py-1">
                      <Show
                        when={groupedModels().length > 0}
                        fallback={
                          <div class="px-3 py-6 text-center text-xs text-muted-foreground">
                            未找到匹配的模型
                          </div>
                        }
                      >
                        <For each={groupedModels()}>
                          {([provider, models]) => (
                            <div>
                              <div class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                {provider}
                              </div>
                              <For each={models}>
                                {(model) => (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedModel(model);
                                      setModelOpen(false);
                                      setModelQuery("");
                                    }}
                                    class={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors ${
                                      currentModel().id === model.id
                                        ? "bg-accent/10 text-foreground"
                                        : "text-muted-foreground hover:bg-muted"
                                    }`}
                                  >
                                    <Icon
                                      name={model.icon}
                                      size="normal"
                                      class={`shrink-0 mt-0.5 ${providerColor(model.provider)}`}
                                    />
                                    <span class="flex-1 min-w-0">
                                      <span class="flex items-center justify-between gap-2">
                                        <span class="text-xs font-medium text-foreground truncate">
                                          {model.name}
                                        </span>
                                        <Show when={currentModel().id === model.id}>
                                          <Icon name="check-small" size="small" class="text-accent shrink-0" />
                                        </Show>
                                      </span>
                                      <span class="block text-[11px] text-muted-foreground truncate">
                                        {model.description}
                                      </span>
                                    </span>
                                  </button>
                                )}
                              </For>
                            </div>
                          )}
                        </For>
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-[10px] text-muted-foreground hidden sm:inline">Enter 发送 · Shift+Enter 换行</span>
              <button
                type="submit"
                disabled={(!input().trim() && attachments().length === 0) || props.disabled}
                class="oc-button oc-button-primary w-8 h-8 p-0 rounded-lg"
                title="发送"
              >
                <Icon name="arrow-up" size="small" />
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default Composer;
