/**
 * Workspace context sidebar. Terminal navigation is owned by the tab strip.
 */
import { type Component, For, Show } from "solid-js";
import { Icon } from "../Icon";
import type { TerminalSession, SessionHealth } from "../../workbench/model";
import type { RuntimePhase } from "../../workbench/types";

interface SessionSidebarProps {
  workspaceName: string;
  workspacePath: string;
  runtimePhase: RuntimePhase;
  showSessions: boolean;
  sessions: TerminalSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onAddSession: () => void;
}

const HealthDot: Component<{ health: SessionHealth; label?: string }> = (
  props,
) => (
  <span
    class={`sc-health-dot is-${props.health}`}
    role="img"
    aria-label={props.label || props.health}
  />
);

const SessionRow: Component<{
  session: TerminalSession;
  active: boolean;
  onSelect: (id: string) => void;
}> = (props) => (
  <button
    type="button"
    class="sc-session-row"
    classList={{ "is-active": props.active }}
    aria-current={props.active ? "page" : undefined}
    title={`${props.session.title} — ${props.session.cwd}`}
    onClick={() => props.onSelect(props.session.id)}
  >
    <HealthDot health={props.session.health} label={props.session.health} />
    <span class="sc-session-copy">
      <strong>{props.session.title}</strong>
      <small>{props.session.cwd}</small>
    </span>
    <Icon name="chevron-right" size="small" class="sc-session-arrow" />
  </button>
);

const phaseHealth = (phase: RuntimePhase): SessionHealth =>
  phase === "ready" ? "ready" : phase === "error" ? "error" : "busy";

const SessionSidebar: Component<SessionSidebarProps> = (props) => (
  <aside class="sc-sidebar" aria-label="工作区上下文">
    <section class="sc-sidebar-section">
      <span class="sc-eyebrow">WORKSPACE</span>
      <div class="sc-workspace-row" title={props.workspacePath}>
        <span class="sc-workspace-mark">OS</span>
        <span class="sc-session-copy">
          <strong>{props.workspaceName}</strong>
          <small>{props.workspacePath}</small>
        </span>
        <HealthDot
          health={phaseHealth(props.runtimePhase)}
          label={`Runtime ${props.runtimePhase}`}
        />
      </div>
    </section>

    <Show when={props.showSessions}>
      <section class="sc-sidebar-section is-flex">
        <header class="sc-section-head">
          <span class="sc-eyebrow">TERMINALS</span>
          <button
            type="button"
            class="sc-icon-button"
            aria-label="新建终端"
            title="新建终端会话"
            onClick={props.onAddSession}
          >
            <Icon name="plus-small" size="small" />
          </button>
        </header>
        <div class="sc-session-list">
          <For each={props.sessions}>
            {(session) => (
              <SessionRow
                session={session}
                active={session.id === props.activeSessionId}
                onSelect={props.onSelectSession}
              />
            )}
          </For>
        </div>
      </section>
    </Show>

    <Show when={!props.showSessions}>
      <div class="sc-sidebar-hint">
        终端会话由顶部标签栏管理，避免重复导航。
      </div>
    </Show>
  </aside>
);

export default SessionSidebar;
