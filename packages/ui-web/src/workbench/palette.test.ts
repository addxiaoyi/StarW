import { describe, expect, it } from "vitest";
import type { PaletteAction } from "./types";
import { filterPaletteActions, groupPaletteActions } from "./palette";

const action = (
  id: string,
  label: string,
  category: string,
  keywords: string[] = [],
): PaletteAction => ({
  id,
  label,
  detail: `${label} detail`,
  icon: "sparkle-2",
  category,
  keywords,
  run: () => undefined,
});

const actions = [
  action("show-files", "Files", "导航", ["文件"]),
  action("agent-general", "General", "Agents", ["代理"]),
  action("skill-git", "Git status", "Skills", ["仓库"]),
  action("settings-provider", "模型 Provider", "设置", ["api key"]),
];

describe("command palette model", () => {
  it("matches every free-text token across metadata", () => {
    expect(
      filterPaletteActions(actions, "api key").map((item) => item.id),
    ).toEqual(["settings-provider"]);
    expect(
      filterPaletteActions(actions, "文件").map((item) => item.id),
    ).toEqual(["show-files"]);
  });

  it("supports OpenCode-style resource scopes", () => {
    expect(
      filterPaletteActions(actions, "@gen").map((item) => item.id),
    ).toEqual(["agent-general"]);
    expect(
      filterPaletteActions(actions, "/git").map((item) => item.id),
    ).toEqual(["skill-git"]);
    expect(
      filterPaletteActions(actions, ":provider").map((item) => item.id),
    ).toEqual(["settings-provider"]);
  });

  it("groups actions in interaction priority order", () => {
    const grouped = groupPaletteActions([
      actions[2],
      actions[3],
      action("refresh", "Refresh", "工作区"),
      action("new-session", "New terminal", "会话"),
      action("clear", "Clear", "当前视图"),
      actions[0],
      actions[1],
    ]);
    expect(grouped.map((group) => group.category)).toEqual([
      "当前视图",
      "会话",
      "工作区",
      "导航",
      "Agents",
      "Skills",
      "设置",
    ]);
  });
});
