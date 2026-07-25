import type { Component } from "solid-js";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { useAppStore } from "../store/app";
import type { ViewMode } from "../types";
import { Icon } from "./Icon";
import { isAcpConnected, onAcpConnectionChange } from "../services/acp";

interface HeaderProps {
  onTogglePalette: () => void;
}

const viewTitles: Record<ViewMode, string> = {
  chat: "对话",
  terminal: "终端",
  canvas: "画布",
  browser: "浏览器",
  swarm: "代理集群",
  templates: "模板市场",
  marketplace: "ECC 市场",
  files: "文件",
  settings: "设置",
};

const Header: Component<HeaderProps> = (props) => {
  const { state, toggleSidebar, toggleTheme } = useAppStore();
  const [connected, setConnected] = createSignal(true);

  onMount(() => {
    setConnected(isAcpConnected());
    const cleanup = onAcpConnectionChange((next) => setConnected(next));
    onCleanup(cleanup);
  });

  return (
    <header class="h-11 shrink-0 flex items-center gap-3 px-3 bg-background/80 backdrop-blur border-b border-border select-none">
      <div class="flex items-center gap-2 w-28">
        <div class="flex items-center gap-1.5">
          <div class="w-3 h-3 rounded-full bg-destructive" />
          <div class="w-3 h-3 rounded-full bg-warning" />
          <div class="w-3 h-3 rounded-full bg-success" />
        </div>
      </div>

      <div class="flex-1 flex items-center justify-center gap-2">
        <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {viewTitles[state().currentMode]}
        </span>
        <Show when={!connected()}>
          <span
            class="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20"
            title="ACP 后端未连接，请运行 openstar start"
          >
            offline
          </span>
        </Show>
      </div>

      <div class="flex items-center justify-end gap-0.5 w-28">
        <button
          onClick={props.onTogglePalette}
          class="oc-icon-button transition-transform duration-150 active:scale-95"
          title="命令面板 (Cmd+K)"
        >
          <Icon name="magnifying-glass" size="small" />
        </button>
        <button
          onClick={toggleTheme}
          class="oc-icon-button transition-transform duration-150 active:scale-95"
          title="切换主题"
        >
          {state().theme === "dark" ? (
            <Icon name="sun" size="small" />
          ) : (
            <Icon name="moon" size="small" />
          )}
        </button>
        <button
          onClick={toggleSidebar}
          class="oc-icon-button transition-transform duration-150 active:scale-95"
          title="切换侧边栏 (Cmd+B)"
        >
          <Icon name="layout-left" size="small" />
        </button>
      </div>
    </header>
  );
};

export default Header;
