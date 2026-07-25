/**
 * OpenStar desktop title bar.
 */
import { type Component, Show } from "solid-js";
import { Icon } from "../Icon";

interface TitleBarProps {
  workspace: string;
  sessionTitle: string;
  inspectorAvailable: boolean;
  sidebarOpen: boolean;
  onOpenPalette: () => void;
  onToggleInspector: () => void;
  onToggleSidebar: () => void;
}

const TitleBar: Component<TitleBarProps> = (props) => (
  <header class="sc-titlebar">
    <div class="sc-brand" title="OpenStar">
      <span class="sc-brand-mark" aria-hidden="true">
        <Icon name="terminal-active" size="normal" />
      </span>
      <strong>OpenStar</strong>
    </div>

    <button
      type="button"
      class="sc-icon-button sc-sidebar-toggle"
      aria-label={props.sidebarOpen ? "折叠侧栏" : "展开侧栏"}
      title={props.sidebarOpen ? "折叠侧栏" : "展开侧栏"}
      onClick={props.onToggleSidebar}
    >
      <Icon name="menu" size="small" />
    </button>

    <div
      class="sc-title-context"
      title={`${props.workspace} / ${props.sessionTitle}`}
    >
      <span>{props.workspace}</span>
      <Icon name="chevron-right" size="small" />
      <strong>{props.sessionTitle}</strong>
    </div>

    <div class="sc-title-actions">
      <button
        type="button"
        class="sc-icon-button"
        aria-label="命令面板"
        title="命令面板 (Ctrl+K)"
        onClick={props.onOpenPalette}
      >
        <Icon name="magnifying-glass" size="small" />
      </button>
      <Show when={props.inspectorAvailable}>
        <button
          type="button"
          class="sc-icon-button"
          aria-label="切换上下文"
          title="显示/隐藏上下文检查器"
          onClick={props.onToggleInspector}
        >
          <Icon name="layout-left" size="small" />
        </button>
      </Show>
    </div>
  </header>
);

export default TitleBar;
