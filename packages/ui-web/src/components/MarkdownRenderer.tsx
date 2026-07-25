import { type Component, createMemo } from "solid-js";
import { marked } from "marked";

interface Props {
  content: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHref(value: string): string {
  const href = value.trim();
  if (
    href.startsWith("#") ||
    href.startsWith("/") ||
    /^(https?:|mailto:)/i.test(href)
  )
    return escapeHtml(href);
  return "#";
}

const renderer = new marked.Renderer();

renderer.html = ({ text }: { text: string }) => escapeHtml(text);

renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = (lang || "text").replace(/[^a-z0-9_+-]/gi, "");
  return `<pre class="oc-markdown-pre"><div class="oc-markdown-code-header"><span>${escapeHtml(language || "text")}</span></div><code class="language-${escapeHtml(language)}">${escapeHtml(text)}</code></pre>`;
};

renderer.codespan = ({ text }: { text: string }) =>
  `<code class="oc-markdown-code">${escapeHtml(text)}</code>`;

renderer.link = ({
  href,
  title,
  text,
}: {
  href: string;
  title?: string | null;
  text: string;
}) => {
  const safe = safeHref(href);
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  const external = /^(https?:|mailto:)/i.test(href);
  return `<a href="${safe}"${titleAttribute}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
});

const MarkdownRenderer: Component<Props> = (props) => {
  const html = createMemo(() => {
    try {
      return marked.parse(props.content || "", { async: false }) as string;
    } catch {
      return escapeHtml(props.content || "");
    }
  });

  return <div class="oc-markdown text-sm leading-relaxed" innerHTML={html()} />;
};

export default MarkdownRenderer;
