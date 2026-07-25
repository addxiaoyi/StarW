import { Component, createSignal, For, Show, createResource, Suspense } from "solid-js";
import { listFiles, readFile, type FileEntry } from "../services/acp";
import { Icon } from "./Icon";

interface TreeNodeProps {
  entry: FileEntry;
  level: number;
  selectedPath: () => string | null;
  onSelect: (entry: FileEntry) => void;
}

const TreeNode: Component<TreeNodeProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [children] = createResource(
    () => (expanded() && props.entry.type === "directory" ? props.entry.path : null),
    listFiles,
  );

  const isSelected = () => props.selectedPath() === props.entry.path;

  const handleClick = () => {
    if (props.entry.type === "directory") {
      setExpanded(!expanded());
    } else {
      props.onSelect(props.entry);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        class={`w-full flex items-center gap-1.5 px-2 py-1 text-sm rounded-md text-left transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-ring)] ${
          isSelected()
            ? "bg-primary/10 text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent/50"
        }`}
        style={{ "padding-left": `${0.5 + props.level * 0.75}rem` }}
        title={props.entry.name}
      >
        <span class="inline-flex w-4 h-4 items-center justify-center text-muted-foreground shrink-0">
          <Show
            when={props.entry.type === "directory"}
            fallback={<Icon name="file" size="small" />}
          >
            <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
          </Show>
        </span>
        <span class="inline-flex w-4 h-4 items-center justify-center shrink-0">
          <Show
            when={props.entry.type === "directory"}
            fallback={<Icon name="file" size="small" />}
          >
            <Icon name={expanded() ? "folder-open" : "folder"} size="small" />
          </Show>
        </span>
        <span class="truncate">{props.entry.name}</span>
      </button>
      <Show when={expanded()}>
        <Suspense
          fallback={
            <div class="pl-6 py-1 space-y-1.5">
              <div class="h-4 oc-skeleton w-2/3" />
              <div class="h-4 oc-skeleton w-1/2" />
            </div>
          }
        >
          <For each={children()}>
            {(child) => (
              <TreeNode
                entry={child}
                level={props.level + 1}
                selectedPath={props.selectedPath}
                onSelect={props.onSelect}
              />
            )}
          </For>
        </Suspense>
      </Show>
    </div>
  );
};

const FileTree: Component = () => {
  const [entries, { refetch: refetchEntries }] = createResource(() => ".", listFiles);
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);
  const [content] = createResource(selectedPath, readFile);

  const handleSelect = (entry: FileEntry) => {
    setSelectedPath(entry.path);
  };

  const selectedName = () => {
    const path = selectedPath();
    if (!path) return "";
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  };

  return (
    <div class="flex h-full bg-background">
      <div class="w-72 flex flex-col border-r border-border bg-sidebar shrink-0">
        <header class="h-10 px-3 flex items-center justify-between border-b border-sidebar-border">
          <span class="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
            Files
          </span>
          <button
            type="button"
            onClick={() => refetchEntries()}
            class="oc-icon-button text-sidebar-foreground/70 hover:text-sidebar-foreground"
            title="刷新文件列表"
          >
            <Icon name="reset" size="small" />
          </button>
        </header>
        <div class="flex-1 overflow-auto py-2">
          <Suspense
            fallback={
              <div class="px-3 py-2 space-y-2">
                <div class="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                  <span class="w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  加载文件中...
                </div>
                <div class="h-5 oc-skeleton w-3/4" />
                <div class="h-5 oc-skeleton w-2/3" />
                <div class="h-5 oc-skeleton w-4/5" />
                <div class="h-5 oc-skeleton w-1/2" />
              </div>
            }
          >
            <Show
              when={entries() && entries()!.length > 0}
              fallback={
                <div class="oc-empty-state py-10">
                  <div class="oc-empty-state-icon">
                    <Icon name="folder" size="large" />
                  </div>
                  <div class="oc-empty-state-title">暂无文件</div>
                  <div class="oc-empty-state-desc">当前目录为空或无法读取。</div>
                </div>
              }
            >
              <For each={entries()}>
                {(entry) => (
                  <TreeNode
                    entry={entry}
                    level={0}
                    selectedPath={selectedPath}
                    onSelect={handleSelect}
                  />
                )}
              </For>
            </Show>
          </Suspense>
        </div>
      </div>
      <div class="flex-1 flex flex-col min-w-0 bg-background">
        <Show
          when={selectedPath()}
          fallback={
            <div class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a file to view its contents
            </div>
          }
        >
          <header class="h-10 px-4 flex items-center border-b border-border bg-card shrink-0">
            <Icon name="file" size="small" class="mr-2 text-muted-foreground" />
            <span class="text-sm font-medium truncate">{selectedName()}</span>
            <Show when={content() === undefined}>
              <span class="ml-auto w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            </Show>
          </header>
          <div class="flex-1 overflow-auto p-4">
            <pre class="font-mono text-sm leading-relaxed text-foreground whitespace-pre-wrap">
              {content()}
            </pre>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default FileTree;
