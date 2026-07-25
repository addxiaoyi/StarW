import { createEffect, createSignal, Show, type Component } from "solid-js";
import { desktopRequest } from "../../services/desktop";
import {
  agentEditorFormFromDefinition,
  buildAgentDefinitionMutation,
  emptyAgentEditorForm,
  validateAgentEditorForm,
  type AgentDefinitionItem,
  type AgentEditorForm,
} from "./agent-editor-model";
import { errorText } from "./runtime-view-utils";

interface AgentEditorPanelProps {
  agent?: AgentDefinitionItem;
  selectedAgentName: string;
  onSaved: (name: string) => Promise<void> | void;
  onNewMode: () => void;
  onDelete: (name: string) => void;
  onError: (message: string) => void;
}

const AgentEditorPanel: Component<AgentEditorPanelProps> = (props) => {
  const [form, setForm] = createSignal<AgentEditorForm>(emptyAgentEditorForm());
  const [editingAgentName, setEditingAgentName] = createSignal<string | null>(
    null,
  );
  const [saving, setSaving] = createSignal(false);
  let loadedSelection = "";

  createEffect(() => {
    const agent = props.agent;
    const selection = `${props.selectedAgentName}:${agent?.name ?? ""}`;
    if (selection === loadedSelection) return;
    loadedSelection = selection;
    setEditingAgentName(agent && !agent.builtIn ? agent.name : null);
    setForm(agentEditorFormFromDefinition(agent));
  });

  const updateForm = <Key extends keyof AgentEditorForm>(
    key: Key,
    value: AgentEditorForm[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const validation = () => validateAgentEditorForm(form());
  const editing = () => Boolean(editingAgentName());

  const enterCreateMode = () => {
    loadedSelection = `${props.selectedAgentName}:`;
    setEditingAgentName(null);
    setForm(emptyAgentEditorForm());
    props.onNewMode();
  };

  const save = async () => {
    if (saving() || !validation().valid) return;
    setSaving(true);
    props.onError("");
    try {
      const mutation = buildAgentDefinitionMutation(form(), editingAgentName());
      await desktopRequest(mutation.method, mutation.payload);
      setEditingAgentName(mutation.payload.name);
      await props.onSaved(mutation.payload.name);
    } catch (cause) {
      props.onError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="oc-agent-editor mt-4 rounded-md border border-border bg-card p-3">
      <div class="flex items-center gap-2">
        <strong class="text-xs">
          {editing() ? "编辑自定义 Agent" : "新建自定义 Agent"}
        </strong>
        <span class="flex-1" />
        <button class="oc-button" type="button" onClick={enterCreateMode}>
          新建模式
        </button>
      </div>
      <label class="mt-2 block text-[11px]" for="agent-name">
        名称
        <input
          id="agent-name"
          class="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          placeholder="review-agent"
          disabled={editing()}
          aria-invalid={Boolean(validation().nameError)}
          aria-describedby="agent-name-help"
          value={form().name}
          onInput={(event) => updateForm("name", event.currentTarget.value)}
        />
      </label>
      <small
        id="agent-name-help"
        classList={{
          "text-error": Boolean(validation().nameError),
          "text-muted-foreground": !validation().nameError,
        }}
      >
        {validation().nameError || "2–32 位小写字母、数字和连字符"}
      </small>
      <label class="mt-2 block text-[11px]" for="agent-description">
        用途说明
        <input
          id="agent-description"
          class="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          placeholder="说明此 Agent 负责的工作"
          aria-invalid={Boolean(validation().descriptionError)}
          value={form().description}
          onInput={(event) =>
            updateForm("description", event.currentTarget.value)
          }
        />
      </label>
      <Show when={validation().descriptionError}>
        <small class="text-error">{validation().descriptionError}</small>
      </Show>
      <label class="mt-2 block text-[11px]" for="agent-instructions">
        系统指令
        <textarea
          id="agent-instructions"
          class="mt-1 min-h-20 w-full resize-y rounded border border-border bg-background p-2 text-xs"
          placeholder="定义边界、输出格式和决策规则"
          value={form().instructions}
          onInput={(event) =>
            updateForm("instructions", event.currentTarget.value)
          }
        />
      </label>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <label class="text-[11px]" for="agent-provider">
          Provider
          <input
            id="agent-provider"
            class="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
            placeholder="继承默认"
            value={form().provider}
            onInput={(event) =>
              updateForm("provider", event.currentTarget.value)
            }
          />
        </label>
        <label class="text-[11px]" for="agent-model">
          Model
          <input
            id="agent-model"
            class="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
            placeholder="继承默认"
            value={form().model}
            onInput={(event) => updateForm("model", event.currentTarget.value)}
          />
        </label>
      </div>
      <label class="mt-2 block text-[11px]" for="agent-allowed-directories">
        允许目录（每行一个）
        <textarea
          id="agent-allowed-directories"
          class="mt-1 min-h-16 w-full resize-y rounded border border-border bg-background p-2 font-mono text-xs"
          placeholder={"src\ntests"}
          value={form().allowedDirectories}
          onInput={(event) =>
            updateForm("allowedDirectories", event.currentTarget.value)
          }
        />
      </label>
      <label class="mt-2 block text-[11px]" for="agent-denied-patterns">
        拒绝模式（每行一个）
        <textarea
          id="agent-denied-patterns"
          class="mt-1 min-h-16 w-full resize-y rounded border border-border bg-background p-2 font-mono text-xs"
          placeholder={"*.env\nsecrets/**"}
          value={form().deniedPatterns}
          onInput={(event) =>
            updateForm("deniedPatterns", event.currentTarget.value)
          }
        />
      </label>
      <fieldset class="mt-2 grid grid-cols-2 gap-1 text-[11px]">
        <legend class="col-span-2 mb-1 text-muted-foreground">能力权限</legend>
        <label>
          <input
            type="checkbox"
            checked={form().canEdit}
            onChange={(event) =>
              updateForm("canEdit", event.currentTarget.checked)
            }
          />{" "}
          修改文件
        </label>
        <label>
          <input
            type="checkbox"
            checked={form().canExecute}
            onChange={(event) =>
              updateForm("canExecute", event.currentTarget.checked)
            }
          />{" "}
          执行命令
        </label>
        <label>
          <input
            type="checkbox"
            checked={form().canUseMcp}
            onChange={(event) =>
              updateForm("canUseMcp", event.currentTarget.checked)
            }
          />{" "}
          MCP
        </label>
        <label>
          <input
            type="checkbox"
            checked={form().canAccessNetwork}
            onChange={(event) =>
              updateForm("canAccessNetwork", event.currentTarget.checked)
            }
          />{" "}
          网络
        </label>
      </fieldset>
      <button
        class="oc-button mt-2 w-full"
        disabled={saving() || !validation().valid}
        onClick={() => void save()}
      >
        {saving() ? "保存中…" : editing() ? "保存 Agent 定义" : "创建 Agent"}
      </button>
      <Show when={editingAgentName()}>
        {(name) => (
          <button
            class="oc-button mt-2 w-full text-error"
            onClick={() => props.onDelete(name())}
          >
            删除当前自定义 Agent
          </button>
        )}
      </Show>
    </div>
  );
};

export default AgentEditorPanel;
