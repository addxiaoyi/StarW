import {
  buildAgentTools,
  parseAgentList,
  validateAgentName,
} from "./agent-runtime-utils";

export interface AgentDefinitionPermission {
  canEdit?: boolean;
  canExecute?: boolean;
  canAccessNetwork?: boolean;
  canUseMcp?: boolean;
  allowedDirectories?: string[];
  deniedPatterns?: string[];
}

export interface AgentDefinitionItem {
  id?: string;
  name: string;
  type: string;
  description: string;
  status: string;
  tasks: number;
  sessions: number;
  tools: string[];
  builtIn?: boolean;
  instructions?: string;
  provider?: string;
  model?: string;
  permission?: AgentDefinitionPermission;
}

export interface AgentEditorForm {
  name: string;
  description: string;
  instructions: string;
  provider: string;
  model: string;
  allowedDirectories: string;
  deniedPatterns: string;
  canEdit: boolean;
  canExecute: boolean;
  canUseMcp: boolean;
  canAccessNetwork: boolean;
}

export interface NormalizedAgentEditorForm {
  name: string;
  description: string;
  instructions: string;
  provider?: string;
  model?: string;
  allowedDirectories: string[];
  deniedPatterns: string[];
  canEdit: boolean;
  canExecute: boolean;
  canUseMcp: boolean;
  canAccessNetwork: boolean;
}

export interface AgentEditorValidation {
  nameError: string;
  descriptionError: string;
  valid: boolean;
}

export interface AgentDefinitionPayload extends Record<string, unknown> {
  name: string;
  description: string;
  instructions: string;
  provider?: string;
  model?: string;
  tools: string[];
  permission: {
    canEdit: boolean;
    canExecute: boolean;
    canUseMcp: boolean;
    canAccessNetwork: boolean;
    allowedDirectories: string[];
    deniedPatterns: string[];
  };
}

export interface AgentDefinitionMutation {
  method: "agent.definitions.create" | "agent.definitions.update";
  payload: AgentDefinitionPayload;
}

export function emptyAgentEditorForm(): AgentEditorForm {
  return {
    name: "",
    description: "",
    instructions: "",
    provider: "",
    model: "",
    allowedDirectories: "",
    deniedPatterns: "",
    canEdit: false,
    canExecute: false,
    canUseMcp: false,
    canAccessNetwork: false,
  };
}

export function agentEditorFormFromDefinition(
  agent?: AgentDefinitionItem,
): AgentEditorForm {
  if (!agent || agent.builtIn) return emptyAgentEditorForm();
  return {
    name: agent.name,
    description: agent.description ?? "",
    instructions: agent.instructions ?? "",
    provider: agent.provider ?? "",
    model: agent.model ?? "",
    allowedDirectories: (agent.permission?.allowedDirectories ?? []).join("\n"),
    deniedPatterns: (agent.permission?.deniedPatterns ?? []).join("\n"),
    canEdit: Boolean(agent.permission?.canEdit),
    canExecute: Boolean(agent.permission?.canExecute),
    canUseMcp: Boolean(agent.permission?.canUseMcp),
    canAccessNetwork: Boolean(agent.permission?.canAccessNetwork),
  };
}

export function normalizeAgentEditorForm(
  form: AgentEditorForm,
): NormalizedAgentEditorForm {
  const provider = form.provider.trim();
  const model = form.model.trim();
  return {
    name: form.name.trim().toLowerCase(),
    description: form.description.trim(),
    instructions: form.instructions.trim(),
    provider: provider || undefined,
    model: model || undefined,
    allowedDirectories: parseAgentList(form.allowedDirectories),
    deniedPatterns: parseAgentList(form.deniedPatterns),
    canEdit: form.canEdit,
    canExecute: form.canExecute,
    canUseMcp: form.canUseMcp,
    canAccessNetwork: form.canAccessNetwork,
  };
}

export function validateAgentEditorForm(
  form: AgentEditorForm,
): AgentEditorValidation {
  const normalized = normalizeAgentEditorForm(form);
  const nameError = validateAgentName(normalized.name);
  const descriptionError = normalized.description ? "" : "用途说明不能为空";
  return {
    nameError,
    descriptionError,
    valid: !nameError && !descriptionError,
  };
}

export function buildAgentDefinitionPayload(
  form: AgentEditorForm,
): AgentDefinitionPayload {
  const normalized = normalizeAgentEditorForm(form);
  return {
    name: normalized.name,
    description: normalized.description,
    instructions: normalized.instructions,
    provider: normalized.provider,
    model: normalized.model,
    tools: buildAgentTools(normalized),
    permission: {
      canEdit: normalized.canEdit,
      canExecute: normalized.canExecute,
      canUseMcp: normalized.canUseMcp,
      canAccessNetwork: normalized.canAccessNetwork,
      allowedDirectories: normalized.allowedDirectories,
      deniedPatterns: normalized.deniedPatterns,
    },
  };
}

export function buildAgentDefinitionMutation(
  form: AgentEditorForm,
  editingAgentName: string | null,
): AgentDefinitionMutation {
  const validation = validateAgentEditorForm(form);
  if (!validation.valid) {
    throw new Error(validation.nameError || validation.descriptionError);
  }
  return {
    method: editingAgentName
      ? "agent.definitions.update"
      : "agent.definitions.create",
    payload: buildAgentDefinitionPayload(form),
  };
}
