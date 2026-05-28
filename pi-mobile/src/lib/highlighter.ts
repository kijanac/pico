import type { HighlighterCore } from "shiki/core";

/**
 * Lazy Shiki singleton.
 *
 * Bundle strategy:
 *   - `shiki/core` + `shiki/engine/javascript` ship in the main chunk
 *     (statically imported). Net cost ≈ 25 KB gz.
 *   - The theme module is a dynamic import → Vite emits a separate chunk
 *     loaded on first highlight.
 *   - Each language is a dynamic import → Vite emits each as its own chunk,
 *     loaded the first time a code block of that language appears.
 *
 * The singleton itself is built lazily on the first call to
 * `highlightToHtml`. Until then no Shiki touches the page.
 */

/** Alias → canonical Shiki language name. */
const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  go: "go",
  golang: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "csharp",
  cs: "csharp",
  rb: "ruby",
  ruby: "ruby",
  php: "php",
  swift: "swift",
  kotlin: "kotlin",
  kt: "kotlin",
  sh: "bash",
  bash: "bash",
  shell: "bash",
  zsh: "bash",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  dockerfile: "dockerfile",
  diff: "diff",
  xml: "xml",
};

/**
 * Static dispatch map for language imports.
 *
 * The bundler can only emit chunks for `import("@shikijs/langs/<literal>")`
 * — a fully-dynamic `import(`@shikijs/langs/${var}`)` is opaque to it.
 */
type LanguageRegistration = Parameters<HighlighterCore["loadLanguage"]>[0];

const LANG_IMPORTS: Record<string, () => Promise<{ default: LanguageRegistration }>> = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  python: () => import("@shikijs/langs/python"),
  rust: () => import("@shikijs/langs/rust"),
  go: () => import("@shikijs/langs/go"),
  java: () => import("@shikijs/langs/java"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  swift: () => import("@shikijs/langs/swift"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  bash: () => import("@shikijs/langs/bash"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  markdown: () => import("@shikijs/langs/markdown"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  sql: () => import("@shikijs/langs/sql"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  diff: () => import("@shikijs/langs/diff"),
  xml: () => import("@shikijs/langs/xml"),
};

const THEME = "github-dark-default";

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadingLangs = new Map<string, Promise<void>>();
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      // Load the highlighter core + engine on first use. Both land in
      // a separate chunk because of the dynamic import.
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
        ]);
      return createHighlighterCore({
        themes: [import("@shikijs/themes/github-dark-default")],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
    })();
  }
  return highlighterPromise;
}

function resolveLang(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return LANG_ALIASES[key] ?? null;
}

async function ensureLang(lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true;
  const importer = LANG_IMPORTS[lang];
  if (!importer) return false;

  // Dedupe concurrent loads of the same language. Two code blocks of the
  // same language inside one assistant message both reach this branch
  // before either resolves; we want one network/chunk fetch, not two.
  let p = loadingLangs.get(lang);
  if (!p) {
    p = (async () => {
      const hl = await getHighlighter();
      const mod = await importer();
      await hl.loadLanguage(mod.default);
      loadedLangs.add(lang);
    })();
    loadingLangs.set(lang, p);
  }

  try {
    await p;
    return true;
  } catch (e) {
    console.warn("[highlighter] load failed", lang, e);
    return false;
  } finally {
    loadingLangs.delete(lang);
  }
}

/**
 * Highlight `code` to a Shiki-styled `<pre class="shiki">…</pre>` HTML
 * string. Returns `null` if the language isn't in our supported set or
 * anything in the pipeline fails — the caller leaves the unstyled
 * `<pre>` already in the DOM untouched in that case.
 */
export async function highlightToHtml(
  code: string,
  langHint: string | null | undefined,
): Promise<string | null> {
  const lang = resolveLang(langHint);
  if (!lang) return null;

  const ok = await ensureLang(lang);
  if (!ok) return null;

  try {
    const hl = await getHighlighter();
    return hl.codeToHtml(code, { lang, theme: THEME });
  } catch (e) {
    console.warn("[highlighter] codeToHtml failed", lang, e);
    return null;
  }
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/**
 * Highlight `code` and return an array of HTML strings, one per line.
 * Each string is a sequence of `<span style="color:…">tok</span>` tokens
 * with the source content HTML-escaped. Trailing newlines are stripped.
 *
 * This is the building block for the diff viewer: we highlight the full
 * old and new files (so syntax context is correct), then index into the
 * result by line number when assembling the unified diff.
 *
 * Returns `null` (one line of plain escaped text) if the language isn't
 * supported.
 */
export async function highlightLines(
  code: string,
  langHint: string | null | undefined,
): Promise<string[] | null> {
  const lang = resolveLang(langHint);
  if (!lang) return null;

  const ok = await ensureLang(lang);
  if (!ok) return null;

  try {
    const hl = await getHighlighter();
    const { tokens } = hl.codeToTokens(code, { lang, theme: THEME });
    return tokens.map((line) =>
      line
        .map(
          (t) =>
            `<span style="color:${t.color ?? "inherit"}">${escapeHtml(
              t.content,
            )}</span>`,
        )
        .join(""),
    );
  } catch (e) {
    console.warn("[highlighter] codeToTokens failed", lang, e);
    return null;
  }
}

/**
 * Best-effort: infer a Shiki language name from a file path's extension.
 * Returns null for paths without a recognized extension (no highlighting).
 */
export function inferLangFromPath(path: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  if (!m) return null;
  return resolveLang(m[1]);
}
