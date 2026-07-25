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
    <section class="mb-4 rounded-md border border-border bg-card p-3">
      <div class="flex flex-wrap items-center gap-2">
        <strong class="text-sm">Agent DAG 编排</strong>
        <span class="text-xs text-muted-foreground">
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
      <label class="mt-3 block text-xs" for="agent-dag-plan">
        DAG 计划（JSON）
        <textarea
          id="agent-dag-plan"
          class="mt-1 min-h-40 w-full resize-y rounded border border-border bg-background p-3 font-mono text-xs"
          value={plan()}
          onInput={(event) => setPlan(event.currentTarget.value)}
          spellcheck={false}
        />
      </label>
      <Show when={results().length > 0}>
        <div class="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>共 {summary().total} 步</span>
          <span>完成 {summary().completed}</span>
          <span classList={{ "text-error": summary().failed > 0 }}>
            失败 {summary().failed}
          </span>
          <span>运行中 {summary().running}</span>
          <span>等待 {summary().pending}</span>
        </div>
        <div class="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <For each={results()}>
            {(step) => (
              <article class="rounded border border-border bg-background p-2 text-xs">
                <div class="flex items-center gap-2">
                  <strong>{step.stepId}</strong>
                  <span class="text-muted-foreground">{step.status}</span>
                </div>
                <div class="mt-1 font-mono text-[10px] text-muted-foreground">
                  task {step.taskId}
                  <Show when={step.sessionId}> · session {step.sessionId}</Show>
                </div>
                <Show when={step.error}>
                  <pre class="mt-2 whitespace-pre-wrap text-error">
                    {step.error}
                  </pre>
                </Show>
                <Show when={step.result !== undefined}>
                  <pre class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-card p-2">
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
