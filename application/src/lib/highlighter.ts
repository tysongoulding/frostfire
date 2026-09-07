import { createHighlighter, Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

export async function getHighlighterInstance(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark-default"],
      langs: [
        "rust",
        "typescript",
        "javascript",
        "python",
        "json",
        "toml",
        "bash",
        "markdown",
        "diff",
      ],
    });
  }
  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  lang: string = "text"
): Promise<string> {
  try {
    const highlighter = await getHighlighterInstance();
    const validLang = highlighter.getLoadedLanguages().includes(lang)
      ? lang
      : "text";
    return highlighter.codeToHtml(code, {
      lang: validLang,
      theme: "github-dark-default",
    });
  } catch {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
