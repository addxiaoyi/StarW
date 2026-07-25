import { Component, For } from "solid-js";
import { useAppStore } from "../store/app";
import type { ViewMode } from "../types";
import { Icon, type IconName } from "./Icon";

interface NavItem {
  id: ViewMode;
  label: string;
  icon: IconName;
}

const navItems: NavItem[] = [
  { id: "chat", label: "对话", icon: "speech-bubble" },
  { id: "terminal", label: "终端", icon: "terminal" },
  { id: "canvas", label: "画布", icon: "photo" },
  { id: "browser", label: "浏览器", icon: "window-cursor" },
  { id: "swarm", label: "代理集群", icon: "subagent" },
  { id: "templates", label: "模板市场", icon: "file-tree" },
  { id: "marketplace", label: "ECC 市场", icon: "server" },
  { id: "files", label: "文件", icon: "folder" },
  { id: "settings", label: "设置", icon: "settings-gear" },
];

const Sidebar: Component = () => {
  const { state, setMode, toggleSidebar } = useAppStore();

  const collapsed = () => state().sidebarCollapsed;

  const navButtonClass = (active: boolean, isCollapsed: boolean) =>
    [
      "relative w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-ring)]",
      active
        ? "oc-nav-active text-sidebar-foreground bg-sidebar-active"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
      isCollapsed ? "justify-center" : "",
    ].join(" ");

  return (
    <aside
      class={`flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-200 ${
        collapsed() ? "w-14" : "w-60"
      }`}
    >
      <div class="flex items-center h-12 px-3 border-b border-sidebar-border">
        <div class="flex items-center gap-2 flex-1 overflow-hidden">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-[var(--oc-info)] flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
            S
          </div>
          <span
            class={`font-semibold text-sm whitespace-nowrap transition-opacity ${
              collapsed() ? "opacity-0 w-0" : "opacity-100"
            }`}
          >
            OpenStar
          </span>
        </div>
        <button
          onClick={toggleSidebar}
          class="oc-icon-button text-sidebar-foreground/70 hover:text-sidebar-foreground"
          title={collapsed() ? "展开侧边栏" : "收起侧边栏"}
        >
          <Icon name={collapsed() ? "chevron-right" : "chevron-left"} size="small" />
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto py-2">
        <div
          class={`px-3 py-1.5 text-[10px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider ${
            collapsed() ? "hidden" : ""
          }`}
        >
          工作区
        </div>
        <ul class="px-2 space-y-0.5">
          <For each={navItems}>
            {(item) => (
              <li>
                <button
                  onClick={() => setMode(item.id)}
                  class={navButtonClass(state().currentMode === item.id, collapsed())}
                  title={item.label}
                >
                  <Icon name={item.icon} size="normal" />
                  <span class={`whitespace-nowrap ${collapsed() ? "hidden" : ""}`}>
                    {item.label}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </nav>
    </aside>
  );
};

export default Sidebar;
