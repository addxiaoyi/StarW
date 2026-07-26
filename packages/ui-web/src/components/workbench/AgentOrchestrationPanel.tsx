import { createSignal, For, Show, type Component } from "solid-js";
import { desktopRequest } from "../../services/desktop";
import {
  createDefaultAgentOrchestrationPlan,
  summarizeAgentOrchestrationResults,
  type AgentOrchestrationResult,
} from "./agent-orchestration-model";
import { parseAgentOrchestrationPlan } from "./agent-runtime-utils";
import { errorText, formatValue } from "./runtime-view-utils";

interface AgentOrchestrationPanelProps {
  onCompleted: () => Promise<void> | void;
  onError: (message: string) => void;
}

const AgentOrchestrationPanel: Component<AgentOrchestrationPanelProps> = (
  props,
) => {
  const [plan, setPlan] = createSignal(createDefaultAgentOrchestrationPlan());
  const [running, setRunning] = createSignal(false);
  const [results, setResults] = createSignal<AgentOrchestrationResult[]>([]);

  const summary = () => summarizeAgentOrchestrationResults(results());

  const run = async () => {
    if (running()) return;
    props.onError("");
    setRunning(true);
    try {
      const tasks = parseAgentOrchestrationPlan(plan());
      const response = await desktopRequest<{
        results: AgentOrchestrationResult[];
      }>("agent.orchestrate", { tasks }, 120_000);
      setResults(response.results);
      await props.onCompleted();
    } catch (cause) {
      props.onError(errorText(cause));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section class="oc-orchestration-panel oc-section">
      <div class="oc-section-header">
        <strong class="oc-section-title">Agent DAG 编排</strong>
        <span class="oc-section-description">
          依赖由 SwarmManager 调度，完成步骤后自动释放后继任务。
        </span>
        <span class="flex-1" />
        <button
          class="oc-button oc-button-primary"
          disabled={running()}
          onClick={() => void run()}
        >
          {running() ? "编排运行中…" : "运行 DAG"}
        </button>
      </div>
      <label class="oc-field" for="agent-dag-plan">
        DAG 计划（JSON）
        <textarea
          id="agent-dag-plan"
          class="oc-code-input"
          value={plan()}
          onInput={(event) => setPlan(event.currentTarget.value)}
          spellcheck={false}
        />
      </label>
      <Show when={results().length > 0}>
        <div class="oc-meta-row">
          <span>共 {summary().total} 步</span>
          <span>完成 {summary().completed}</span>
          <span classList={{ "text-error": summary().failed > 0 }}>
            失败 {summary().failed}
          </span>
          <span>运行中 {summary().running}</span>
          <span>等待 {summary().pending}</span>
        </div>
        <div class="oc-result-grid">
          <For each={results()}>
            {(step) => (
              <article class="oc-result-row">
                <div class="oc-result-row-header">
                  <strong>{step.stepId}</strong>
                  <span class="text-muted-foreground">{step.status}</span>
                </div>
                <div class="oc-result-row-meta">
                  task {step.taskId}
                  <Show when={step.sessionId}> · session {step.sessionId}</Show>
                </div>
                <Show when={step.error}>
                  <pre class="mt-2 whitespace-pre-wrap text-error">
                    {step.error}
                  </pre>
                </Show>
                <Show when={step.result !== undefined}>
                  <pre class="oc-code-panel is-compact">
                    {formatValue(step.result)}
                  </pre>
                </Show>
              </article>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
};

export default AgentOrchestrationPanel;
