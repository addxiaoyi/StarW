export interface AgentOrchestrationStep {
  id: string;
  agent: string;
  prompt: string;
  dependsOn: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeAgentOrchestrationPlan(
  value: unknown,
): AgentOrchestrationStep[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Orchestration tasks are required");
  if (value.length > 12)
    throw new Error("Orchestration supports at most 12 tasks");
  const result: AgentOrchestrationStep[] = [];
  const known = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isRecord(item))
      throw new Error(`Orchestration task ${index + 1} must be an object`);
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : `task-${index + 1}`;
    const agent = typeof item.agent === "string" ? item.agent.trim() : "";
    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id))
      throw new Error(`Invalid orchestration task id: ${id}`);
    if (known.has(id))
      throw new Error(`Duplicate orchestration task id: ${id}`);
    if (!agent)
      throw new Error(`Agent is required for orchestration task ${id}`);
    if (!prompt)
      throw new Error(`Prompt is required for orchestration task ${id}`);
    const dependsOn = Array.isArray(item.dependsOn)
      ? [
          ...new Set(
            item.dependsOn
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.trim())
              .filter(Boolean),
          ),
        ]
      : [];
    for (const dependency of dependsOn) {
      if (!known.has(dependency))
        throw new Error(
          `Task ${id} depends on unknown or later task ${dependency}`,
        );
    }
    result.push({ id, agent, prompt, dependsOn });
    known.add(id);
  }
  return result;
}
