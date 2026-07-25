import { describe, expect, it } from "vitest";
import {
  booleanParam,
  isRecord,
  normalizeAgentToolCalls,
  normalizeToolResult,
  numberParam,
  stringParam,
} from "../src/engine-input.js";

describe("desktop engine input helpers", () => {
  it("recognizes plain records only", () => {
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("value")).toBe(false);
  });

  it("filters malformed agent tool calls", () => {
    expect(
      normalizeAgentToolCalls([
        {
          id: "call-1",
          function: { name: "read_file", arguments: '{"path":"a.txt"}' },
        },
        {
          id: "call-2",
          function: { name: "write_file", arguments: { path: "b.txt" } },
        },
        { id: "missing-name", function: { arguments: "{}" } },
        null,
      ]),
    ).toEqual([
      {
        id: "call-1",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"a.txt"}' },
      },
      {
        id: "call-2",
        type: "function",
        function: { name: "write_file", arguments: { path: "b.txt" } },
      },
    ]);
  });

  it("uses typed parameter values and safe fallbacks", () => {
    const params = {
      text: "value",
      enabled: true,
      count: 4,
      infinite: Number.POSITIVE_INFINITY,
    };
    expect(stringParam(params, "text", "fallback")).toBe("value");
    expect(stringParam(params, "missing", "fallback")).toBe("fallback");
    expect(booleanParam(params, "enabled")).toBe(true);
    expect(booleanParam(params, "text", false)).toBe(false);
    expect(numberParam(params, "count", 1)).toBe(4);
    expect(numberParam(params, "infinite", 1)).toBe(1);
  });

  it("normalizes successful and failed MCP-style tool results", () => {
    const success = normalizeToolResult({
      content: [{ type: "text", text: "first" }, { text: "second" }],
    });
    expect(success.success).toBe(true);
    expect(success.output.content).toBe("first\nsecond");
    expect(success.error).toBeUndefined();

    const failure = normalizeToolResult({ isError: true, content: [] });
    expect(failure.success).toBe(false);
    expect(failure.error).toBe("Tool execution failed");
  });
});
