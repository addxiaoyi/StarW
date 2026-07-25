/**
 * OpenStar runtime status bar.
 */
import { type Component, Show } from "solid-js";
import { Icon } from "../Icon";
import type { RuntimePhase, StarCoreStatus } from "../../workbench/types";

interface StatusBarProps {
  runtimePhase: RuntimePhase;
  runtimeStatus?: StarCoreStatus;
  branch?: string;
  version: string;
}

const PHASE_LABELS: Record<RuntimePhase, string> = {
  loading: "正在连接",
  ready: "已就绪",
  preview: "预览模式",
  error: "连接错误",
};

const StatusBar: Component<StatusBarProps> = (props) => {
  const healthClass = () =>
    props.runtimePhase === "ready"
      ? "is-ready"
      : props.runtimePhase === "error"
        ? "is-error"
        : "is-busy";

  return (
    <footer class="sc-statusbar" aria-live="polite">
      <span>
        <span class={`sc-health-dot ${healthClass()}`} aria-hidden="true" />
        <span>
          Core {props.runtimeStatus?.core || PHASE_LABELS[props.runtimePhase]}
        </span>
        <span class="sr-only">，{PHASE_LABELS[props.runtimePhase]}</span>
      </span>

      <Show when={props.branch}>
        <span title={props.branch}>
          <Icon name="branch" size="small" />
          <span class="sc-status-truncate">{props.branch}</span>
        </span>
      </Show>

      <span class="sc-status-spacer" />
      <Show when={props.version}>
        <span>{props.version}</span>
      </Show>
    </footer>
  );
};

export default StatusBar;
