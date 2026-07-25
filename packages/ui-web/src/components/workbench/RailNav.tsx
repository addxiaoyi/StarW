/**
 * RailNav - 左侧工具栏导航
 * 图标按钮快速切换工作模式
 */
import { type Component, For } from "solid-js";
import { Icon } from "../Icon";
import type { NavItem, WorkbenchMode } from "../../workbench/types";

interface RailNavProps {
  items: NavItem[];
  activeMode: WorkbenchMode;
  onSelect: (mode: WorkbenchMode) => void;
  onOpenSettings: () => void;
}

const RailNav: Component<RailNavProps> = (props) => {
  const handleSelect = (id: WorkbenchMode) => {
    props.onSelect(id);
  };

  return (
    <nav class="sc-rail" aria-label="工作台工具">
      <div class="sc-rail-top">
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              class="sc-rail-button"
              classList={{ "is-active": props.activeMode === item.id }}
              aria-label={item.label}
              title={item.label}
              onClick={() => handleSelect(item.id)}
            >
              <Icon name={item.icon as any} size="normal" />
            </button>
          )}
        </For>
      </div>

      <button
        type="button"
        class="sc-rail-button"
        classList={{ "is-active": props.activeMode === "settings" }}
        aria-label="设置"
        title="设置"
        onClick={props.onOpenSettings}
      >
        <Icon name="settings-gear" size="normal" />
      </button>
    </nav>
  );
};

export default RailNav;
