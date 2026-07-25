/**
 * Minimal Markdown renderer for the TUI.
 * Supports: # headings, **bold**, *italic*, `code`, - lists, > quotes, blank lines.
 * Returns ANSI-styled strings (no wrapping — caller wraps).
 */
import pc from "picocolors";

export function renderMarkdown(md: string): string {
  return md
    .split("\n")
    .map((line) => renderLine(line))
    .join("\n");
}

function renderInline(text: string): string {
  // Code spans
  text = text.replace(/`([^`]+)`/g, (_m, c) => pc.bgBlack(pc.white(String(c))));
  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, (_m, c) => pc.bold(String(c)));
  // Italic
  text = text.replace(/\*([^*]+)\*/g, (_m, c) => pc.italic(String(c)));
  return text;
}

function renderLine(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("### ")) return pc.bold(pc.cyan(trimmed.slice(4)));
  if (trimmed.startsWith("## ")) return pc.bold(pc.cyan(trimmed.slice(3)));
  if (trimmed.startsWith("# ")) return pc.bold(pc.white(trimmed.slice(2)));
  if (trimmed.startsWith("> ")) return pc.dim("│ " + renderInline(trimmed.slice(2)));
  if (trimmed.startsWith("- ")) return pc.cyan("• ") + renderInline(trimmed.slice(2));
  if (trimmed.startsWith("* ")) return pc.cyan("• ") + renderInline(trimmed.slice(2));
  if (trimmed === "") return "";
  return renderInline(line);
}
