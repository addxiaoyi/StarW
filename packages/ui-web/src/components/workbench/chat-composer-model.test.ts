import { describe, expect, it } from "vitest";
import {
  buildComposerPrompt,
  filterComposerCommands,
  findComposerTrigger,
  parseComposerPrompt,
  removeComposerTrigger,
  stripComposerPrompt,
} from "./chat-composer-model";

describe("chat composer model", () => {
  it("finds file and slash-command triggers at the caret", () => {
    expect(findComposerTrigger("inspect @src/main", 17)).toEqual({
      kind: "file",
      query: "src/main",
      start: 8,
      end: 17,
    });
    expect(findComposerTrigger("please /rev", 11)).toEqual({
      kind: "command",
      query: "rev",
      start: 7,
      end: 11,
    });
    expect(findComposerTrigger("path/to/file", 12)).toBeNull();
  });

  it("removes only the active trigger token", () => {
    const trigger = findComposerTrigger("review @src/app.ts now", 18);
    expect(trigger).not.toBeNull();
    expect(removeComposerTrigger("review @src/app.ts now", trigger!)).toEqual({
      text: "review  now",
      caret: 7,
    });
  });

  it("filters slash commands across labels and localized keywords", () => {
    expect(filterComposerCommands("rev").map((item) => item.id)).toEqual([
      "review",
    ]);
    expect(filterComposerCommands("测试").map((item) => item.id)).toEqual([
      "test",
    ]);
  });

  it("round-trips plan mode, commands and referenced files", () => {
    const prompt = buildComposerPrompt("Check this behavior", "plan", {
      command: "review",
      files: [
        { path: "src/main.ts", name: "main.ts" },
        { path: "package.json", name: "package.json" },
      ],
    });
    expect(parseComposerPrompt(prompt)).toEqual({
      text: "Check this behavior",
      mode: "plan",
      command: "review",
      files: [
        { path: "src/main.ts", name: "main.ts" },
        { path: "package.json", name: "package.json" },
      ],
    });
    expect(stripComposerPrompt(prompt)).toBe("Check this behavior");
  });

  it("keeps ordinary prompts unchanged", () => {
    expect(parseComposerPrompt("hello")).toEqual({
      text: "hello",
      mode: "build",
      files: [],
    });
  });
});
