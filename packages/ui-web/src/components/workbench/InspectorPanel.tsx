/**
 * InspectorPanel - 运行时上下文检查器
 * 显示 Agent、Skill、MCP 连接状态
 */
import { type Component, For, Show, Switch, Match } from "solid-js";
import { Icon } from "../Icon";
import type {
  RuntimeSnapshot,
  InspectorMode,
  StarCoreAgent,
  StarCoreSkill,
} from "../../workbench/types";

const LoadingView: Component = () => (
  <div class="sc-loading-view" aria-label="加载中" role="status">
    <span />
    <span />
    <span />
  </div>
);

const InspectorTab: Component<{
  id: InspectorMode;
  label: string;
  active: boolean;
  onSelect: (id: InspectorMode) => void;
}> = (props) => (
  <button
    id={`inspector-tab-${props.id}`}
    type="button"
    classList={{ "is-active": props.active }}
    role="tab"
    aria-selected={props.active}
    aria-controls={`inspector-panel-${props.id}`}
    tabIndex={props.active ? 0 : -1}
    onClick={() => props.onSelect(props.id)}
  >
    {props.label}
  </button>
);

const AgentRow: Component<{ agent: StarCoreAgent }> = (props) => (
  <div class="sc-runtime-row">
    <span class={`sc-agent-mark is-${props.agent.status}`} aria-hidden="true">
      <Icon name="subagent" size="small" />
    </span>
    <span class="sc-runtime-copy">
      <strong>{props.agent.name}</strong>
      <small>
        {props.agent.tasks} tasks
        <Show when={props.agent.description}> · {props.agent.description}</Show>
      </small>
    </span>
    <span class="sc-row-status">{props.agent.status}</span>
  </div>
);

const SkillRow: Component<{
  skill: StarCoreSkill;
  onUse: (name: string) => void;
}> = (props) => (
  <button
    type="button"
    class="sc-runtime-row is-button"
    aria-label={`配置并运行 ${props.skill.name}`}
    title={`在 Skills 页面配置 ${props.skill.name}`}
    onClick={() => props.onUse(props.skill.name)}
  >
    <span class="sc-agent-mark is-skill" aria-hidden="true">
      <Icon name="zap" size="small" />
    </span>
    <span class="sc-runtime-copy">
      <strong>/{props.skill.name}</strong>
      <small>{props.skill.description}</small>
    </span>
    <Icon name="chevron-right" size="small" />
  </button>
);

const McpServerRow: Component<{
  server: { name: string; status: string; toolCount?: number; error?: string };
}> = (props) => (
  <div class="sc-runtime-row">
    <span class="sc-agent-mark is-mcp" aria-hidden="true">
      <Icon name="mcp" size="small" />
    </span>
    <span class="sc-runtime-copy">
      <strong>{props.server.name}</strong>
      <small>
        {props.server.toolCount ?? 0} tools
        <Show when={props.server.error}> · {props.server.error}</Show>
      </small>
    </span>
    <span class="sc-row-status">
      <span
        class={`sc-health-dot ${
          props.server.status === "connected" ? "is-ready" : "is-error"
        }`}
        aria-hidden="true"
      />
      {props.server.status}
    </span>
  </div>
);

const SummaryBar: Component<{
  leftLabel: string;
  leftValue: number;
  rightLabel: string;
  rightValue: number;
}> = (props) => (
  <div class="sc-inspector-summary">
    <span>
      {props.leftValue} {props.leftLabel}
    </span>
    <span>
      {props.rightValue} {props.rightLabel}
    </span>
  </div>
);

interface InspectorPanelProps {
  runtime: RuntimeSnapshot;
  mode: InspectorMode;
  onModeChange: (mode: InspectorMode) => void;
  onRetry: () => void;
  onUseSkill: (name: string) => void;
}

const InspectorPanel: Component<InspectorPanelProps> = (props) => {
  const getPhaseChipClass = () => `sc-runtime-chip is-${props.runtime.phase}`;

  const getPhaseLabel = () => {
    switch (props.runtime.phase) {
      case "ready":
        return "Live";
      case "loading":
        return "Loading";
      case "preview":
        return "Preview";
      case "error":
        return "Error";
    }
  };

  return (
    <aside class="sc-inspector" aria-label="上下文检查器">
      <header class="sc-inspector-head">
        <div>
          <span class="sc-eyebrow">CONTEXT</span>
          <strong>Workspace runtime</strong>
        </div>
        <span class={getPhaseChipClass()}>{getPhaseLabel()}</span>
      </header>

      <div class="sc-segmented" role="tablist" aria-label="上下文视图">
        <InspectorTab
          id="agents"
          label="Agent"
          active={props.mode === "agents"}
          onSelect={props.onModeChange}
        />
        <InspectorTab
          id="skills"
          label="技能"
          active={props.mode === "skills"}
          onSelect={props.onModeChange}
        />
        <InspectorTab
          id="mcp"
          label="MCP"
          active={props.mode === "mcp"}
          onSelect={props.onModeChange}
        />
      </div>

      <Show when={props.runtime.phase === "loading"}>
        <LoadingView />
      </Show>

      <Show
        when={
          props.runtime.phase === "preview" || props.runtime.phase === "error"
        }
      >
        <div class="sc-runtime-error" role="alert">
          <Icon
            name={
              props.runtime.phase === "preview" ? "window-cursor" : "warning"
            }
            size="normal"
          />
          <strong>
            {props.runtime.phase === "preview"
              ? "Desktop bridge unavailable"
              : "Runtime check failed"}
          </strong>
          <span>{props.runtime.error}</span>
          <Show when={props.runtime.phase === "error"}>
            <button
              type="button"
              class="sc-text-button"
              onClick={props.onRetry}
            >
              重试
            </button>
          </Show>
        </div>
      </Show>

      <Show when={props.runtime.phase === "ready"}>
        <div
          id={`inspector-panel-${props.mode}`}
          class="sc-inspector-body"
          role="tabpanel"
          aria-labelledby={`inspector-tab-${props.mode}`}
          tabIndex={0}
        >
          <Switch>
            <Match when={props.mode === "agents"}>
              <SummaryBar
                leftLabel="active"
                leftValue={
                  props.runtime.agents.filter(
                    (agent) => agent.status === "running",
                  ).length
                }
                rightLabel="total"
                rightValue={props.runtime.agents.length}
              />
              <For each={props.runtime.agents}>
                {(agent) => <AgentRow agent={agent} />}
              </For>
            </Match>

            <Match when={props.mode === "skills"}>
              <SummaryBar
                leftLabel="enabled"
                leftValue={
                  props.runtime.skills.filter((skill) => skill.enabled).length
                }
                rightLabel="loaded"
                rightValue={
                  props.runtime.status?.skillsLoaded ??
                  props.runtime.skills.length
                }
              />
              <For each={props.runtime.skills}>
                {(skill) => <SkillRow skill={skill} onUse={props.onUseSkill} />}
              </For>
            </Match>

            <Match when={props.mode === "mcp"}>
              <SummaryBar
                leftLabel="connected"
                leftValue={props.runtime.mcp?.connected ?? 0}
                rightLabel="total"
                rightValue={props.runtime.mcp?.total ?? 0}
              />
              <For each={props.runtime.mcp?.servers ?? []}>
                {(server) => <McpServerRow server={server} />}
              </For>
            </Match>
          </Switch>
        </div>
      </Show>
    </aside>
  );
};

export default InspectorPanel;
