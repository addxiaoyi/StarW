/**
 * TUI Themes
 * Self-contained color themes (no external deps). Uses ANSI via picocolors
 * when available, falling back to plain strings.
 */
import pc from "picocolors";

export interface Theme {
  name: string;
  primary: (s: string) => string;
  secondary: (s: string) => string;
  accent: (s: string) => string;
  success: (s: string) => string;
  warn: (s: string) => string;
  error: (s: string) => string;
  dim: (s: string) => string;
  border: string;
  bgPanel: string;
}

function makeTheme(name: string, border: string, bg: string): Theme {
  return {
    name,
    primary: pc.cyan,
    secondary: pc.blue,
    accent: pc.magenta,
    success: pc.green,
    warn: pc.yellow,
    error: pc.red,
    dim: pc.dim,
    border,
    bgPanel: bg,
  };
}

export const themes: Record<string, Theme> = {
  midnight: makeTheme("midnight", pc.cyan("─"), ""),
  nebula: makeTheme("nebula", pc.magenta("─"), ""),
  matrix: makeTheme("matrix", pc.green("─"), ""),
  mono: makeTheme("mono", pc.white("─"), ""),
};

export function getTheme(name?: string): Theme {
  return (name && themes[name]) || themes.midnight;
}
