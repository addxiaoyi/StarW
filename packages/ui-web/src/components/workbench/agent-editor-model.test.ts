import { describe, expect, it } from "vitest";
import {
  agentEditorFormFromDefinition,
  buildAgentDefinitionMutation,
  buildAgentDefinitionPayload,
  emptyAgentEditorForm,
  normalizeAgentEditorForm,
  validateAgentEditorForm,
  type AgentDefinitionItem,
  type AgentEditorForm,
} from "./agent-editor-model";

const definition = (
  overrides: Partial<AgentDefinitionItem> = {},
): AgentDefinitionItem => ({
  name: "review-agent",
  type: "custom",
  description: "Reviews changes",
  status: "idle",
  tasks: 0,
  sessions: 0,
  tools: ["read"],
  ...overrides,
});

const validForm = (
  overrides: Partial<AgentEditorForm> = {},
): AgentEditorForm => ({
  ...emptyAgentEditorForm(),
  name: "review-agent",
  description: "Reviews changes",
  ...overrides,
});

describe("agent editor model", () => {
  it("creates isolated empty form values", () => {
    const first = emptyAgentEditorForm();
    const second = emptyAgentEditorForm();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("refills a custom Agent definition into one form state", () => {
    expect(
      agentEditorFormFromDefinition(
        definition({
          instructions: "Review carefully",
          provider: "openai",
          model: "gpt-test",
          permission: {
            canEdit: true,
            canUseMcp: true,
            allowedDirectories: ["src", "tests"],
            deniedPatterns: ["*.env", "secrets/**"],
          },
        }),
      ),
    ).toEqual({
      name: "review-agent",
      description: "Reviews changes",
      instructions: "Review carefully",
      provider: "openai",
      model: "gpt-test",
      allowedDirectories: "src\ntests",
      deniedPatterns: "*.env\nsecrets/**",
      canEdit: true,
      canExecute: false,
      canUseMcp: true,
      canAccessNetwork: false,
    });
    expect(
      agentEditorFormFromDefinition(definition({ builtIn: true })),
    ).toEqual(emptyAgentEditorForm());
  });

  it("normalizes names, optional fields and permission lists", () => {
    expect(
      normalizeAgentEditorForm(
        validForm({
          name: " Review-Agent ",
          description: "  Reviews changes  ",
          instructions: "  Be precise  ",
          provider: "   ",
          model: " custom-model ",
          allowedDirectories: "src, tests\n docs ",
          deniedPatterns: "*.env\nsecrets/**",
        }),
      ),
    ).toEqual({
      name: "review-agent",
      description: "Reviews changes",
      instructions: "Be precise",
      provider: undefined,
      model: "custom-model",
      allowedDirectories: ["src", "tests", "docs"],
      deniedPatterns: ["*.env", "secrets/**"],
      canEdit: false,
      canExecute: false,
      canUseMcp: false,
      canAccessNetwork: false,
    });
  });

  it("maps capabilities into tools and permission payloads", () => {
    expect(
      buildAgentDefinitionPayload(
        validForm({
          canEdit: true,
          canExecute: true,
          canUseMcp: true,
          canAccessNetwork: true,
          allowedDirectories: "src\ntests",
        }),
      ),
    ).toMatchObject({
      tools: ["read", "grep", "skill:*", "write", "edit", "bash", "mcp:*"],
      permission: {
        canEdit: true,
        canExecute: true,
        canUseMcp: true,
        canAccessNetwork: true,
        allowedDirectories: ["src", "tests"],
        deniedPatterns: [],
      },
    });
  });

  it("chooses create or update only from explicit editor mode", () => {
    expect(buildAgentDefinitionMutation(validForm(), null).method).toBe(
      "agent.definitions.create",
    );
    expect(
      buildAgentDefinitionMutation(validForm(), "review-agent").method,
    ).toBe("agent.definitions.update");
  });

  it("rejects invalid names and blank descriptions", () => {
    expect(
      validateAgentEditorForm(validForm({ name: "1-invalid" })),
    ).toMatchObject({ valid: false });
    expect(validateAgentEditorForm(validForm({ description: "  " }))).toEqual({
      nameError: "",
      descriptionError: "用途说明不能为空",
      valid: false,
    });
    expect(() =>
      buildAgentDefinitionMutation(validForm({ description: "" }), null),
    ).toThrow(/用途说明不能为空/);
  });
});
