import type { PaletteAction } from "./types";

export interface PaletteActionGroup {
  category: string;
  actions: PaletteAction[];
}

const CATEGORY_ORDER = [
  "当前视图",
  "会话",
  "工作区",
  "导航",
  "Agents",
  "Skills",
  "MCP",
  "设置",
  "界面",
];

const SCOPE_CATEGORY: Record<string, string> = {
  "@": "Agents",
  "/": "Skills",
  ":": "设置",
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function filterPaletteActions(
  actions: PaletteAction[],
  rawQuery: string,
): PaletteAction[] {
  let query = normalize(rawQuery);
  const scopedCategory = SCOPE_CATEGORY[query.slice(0, 1)];
  if (scopedCategory) query = normalize(query.slice(1));
  const tokens = query.split(/\s+/).filter(Boolean);

  return actions.filter((action) => {
    if (scopedCategory && action.category !== scopedCategory) return false;
    if (!tokens.length) return true;
    const haystack = normalize(
      [
        action.id,
        action.label,
        action.detail,
        action.category,
        ...(action.keywords ?? []),
      ].join(" "),
    );
    return tokens.every((token) => haystack.includes(token));
  });
}

export function groupPaletteActions(
  actions: PaletteAction[],
): PaletteActionGroup[] {
  const groups = new Map<string, PaletteAction[]>();
  for (const action of actions) {
    const list = groups.get(action.category) ?? [];
    list.push(action);
    groups.set(action.category, list);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      const leftIndex = CATEGORY_ORDER.indexOf(left);
      const rightIndex = CATEGORY_ORDER.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1)
        return left.localeCompare(right);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    })
    .map(([category, groupedActions]) => ({
      category,
      actions: groupedActions,
    }));
}
