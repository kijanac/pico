import type { ShikiPrimitive } from "shiki/core";

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

type LanguageRegistration = Parameters<ShikiPrimitive["loadLanguage"]>[0];
type Shiki = typeof import("./shiki");

const LANG_IMPORTS: Record<string, () => Promise<{ default: LanguageRegistration }>> = {
  typescript: () => import("@shikijs/langs-precompiled/typescript"),
  tsx: () => import("@shikijs/langs-precompiled/tsx"),
  javascript: () => import("@shikijs/langs-precompiled/javascript"),
  jsx: () => import("@shikijs/langs-precompiled/jsx"),
  python: () => import("@shikijs/langs-precompiled/python"),
  rust: () => import("@shikijs/langs-precompiled/rust"),
  go: () => import("@shikijs/langs-precompiled/go"),
  java: () => import("@shikijs/langs-precompiled/java"),
  c: () => import("@shikijs/langs-precompiled/c"),
  cpp: () => import("@shikijs/langs-precompiled/cpp"),
  csharp: () => import("@shikijs/langs-precompiled/csharp"),
  ruby: () => import("@shikijs/langs-precompiled/ruby"),
  php: () => import("@shikijs/langs-precompiled/php"),
  swift: () => import("@shikijs/langs-precompiled/swift"),
  kotlin: () => import("@shikijs/langs-precompiled/kotlin"),
  bash: () => import("@shikijs/langs-precompiled/bash"),
  json: () => import("@shikijs/langs-precompiled/json"),
  jsonc: () => import("@shikijs/langs-precompiled/jsonc"),
  yaml: () => import("@shikijs/langs-precompiled/yaml"),
  toml: () => import("@shikijs/langs-precompiled/toml"),
  markdown: () => import("@shikijs/langs-precompiled/markdown"),
  html: () => import("@shikijs/langs-precompiled/html"),
  css: () => import("@shikijs/langs-precompiled/css"),
  scss: () => import("@shikijs/langs-precompiled/scss"),
  sql: () => import("@shikijs/langs-precompiled/sql"),
  dockerfile: () => import("@shikijs/langs-precompiled/dockerfile"),
  diff: () => import("@shikijs/langs-precompiled/diff"),
  xml: () => import("@shikijs/langs-precompiled/xml"),
};

const LIGHT_THEME = "github-light-default";
const DARK_THEME = "github-dark-default";
const SHIKI_THEMES = { light: LIGHT_THEME, dark: DARK_THEME } as const;
// Do not let Shiki emit a fixed inline `color:`; CSS below selects the right
// token variable for the app's explicit `.dark` / `data-theme` state.
const DEFAULT_COLOR = false as const;

let highlighterPromise: Promise<{ shiki: Shiki; primitive: ShikiPrimitive }> | null = null;
const loadingLangs = new Map<string, Promise<void>>();
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<{ shiki: Shiki; primitive: ShikiPrimitive }> {
  highlighterPromise ??= (async () => {
    const [shiki, themes] = await Promise.all([import("./shiki"), loadThemes()]);
    const primitive = await shiki.createShikiPrimitiveAsync({
      themes,
      langs: [],
      engine: shiki.createJavaScriptRawEngine(),
    });
    return { shiki, primitive };
  })();
  return highlighterPromise;
}

async function loadThemes() {
  const [lightTheme, darkTheme] = await Promise.all([
    import("@shikijs/themes/github-light-default"),
    import("@shikijs/themes/github-dark-default"),
  ]);
  return [lightTheme.default, darkTheme.default];
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

  let p = loadingLangs.get(lang);
  if (!p) {
    p = (async () => {
      const { primitive } = await getHighlighter();
      const mod = await importer();
      await primitive.loadLanguage(mod.default);
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

function shikiTokenStyleAttr(style: Record<string, string | number> | undefined): string {
  const light = style?.["--shiki-light"];
  const dark = style?.["--shiki-dark"];
  if (!light && !dark) return "";

  const declarations = [
    light ? `--shiki-light:${escapeHtml(String(light))}` : "",
    dark ? `--shiki-dark:${escapeHtml(String(dark))}` : "",
  ].filter(Boolean);
  return ` style="${declarations.join(";")}"`;
}

// Colouring runs a slice of lines at a time and lets the page respond between
// slices, so a huge block never freezes it. Each slice resumes from the
// grammar state the last one ended in, so colours stay right across slices,
// as editors do it. Slices are sized by time, not lines: a slice aims at this
// much work, half a 60 Hz frame, and the next is sized from this one's pace
// (the first slices of a language also compile its patterns, so they're slow).
const SLICE_BUDGET_MS = 8;
const FIRST_SLICE_LINES = 20;
// Past this a block stays plain: not for time, which slicing handles, but
// memory (a span per token). Above a single long model reply.
const MAX_HIGHLIGHT_CHARS = 300_000;
// A longer line stays plain, so one minified line can't hold a slice for
// long (VS Code's default limit).
const MAX_LINE_CHARS = 20_000;

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Each line as HTML token spans carrying both themes' colors as CSS variables.
// null: not highlighted (unknown language, too large, failed or aborted).
export async function highlightLines(
  code: string,
  langHint: string | null | undefined,
  signal?: AbortSignal,
): Promise<string[] | null> {
  if (code.length > MAX_HIGHLIGHT_CHARS) return null;
  const lang = resolveLang(langHint);
  if (!lang) return null;

  const ok = await ensureLang(lang);
  if (!ok) return null;

  try {
    const { shiki, primitive } = await getHighlighter();
    const lines = code.split("\n");
    const out: string[] = [];
    let grammarState: ReturnType<typeof shiki.codeToTokens>["grammarState"];
    let size = FIRST_SLICE_LINES;
    for (let start = 0; start < lines.length; ) {
      if (start > 0) await nextTask();
      if (signal?.aborted) return null;
      const end = Math.min(lines.length, start + size);
      const began = performance.now();
      const result = shiki.codeToTokens(primitive, lines.slice(start, end).join("\n"), {
        lang,
        themes: SHIKI_THEMES,
        defaultColor: DEFAULT_COLOR,
        grammarState,
        tokenizeMaxLineLength: MAX_LINE_CHARS,
      });
      const took = Math.max(performance.now() - began, 0.1);
      grammarState = result.grammarState;
      for (const line of result.tokens) {
        out.push(line.map((t) => `<span class="code-token"${shikiTokenStyleAttr(t.htmlStyle)}>${escapeHtml(t.content)}</span>`).join(""));
      }
      size = Math.max(1, Math.round(((end - start) * SLICE_BUDGET_MS) / took));
      start = end;
    }
    return out;
  } catch (e) {
    console.warn("[highlighter] codeToTokens failed", lang, e);
    return null;
  }
}

// A whole block, in the same pre.shiki > code > span.line shape as Shiki's codeToHtml.
export async function highlightToHtml(
  code: string,
  langHint: string | null | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  const lines = await highlightLines(code, langHint, signal);
  if (!lines) return null;
  return `<pre class="shiki" tabindex="0"><code>${lines.map((line) => `<span class="line">${line}</span>`).join("\n")}</code></pre>`;
}

// Engine, theme and grammar setup cost hundreds of ms; warm during idle so the
// first code fence doesn't stall. Highlighting a line, not just loading the
// grammar, also compiles its regexes.
const WARM_LANGS = ["typescript", "bash"];

export function warmHighlighter(): void {
  const warm = () => {
    void Promise.all(WARM_LANGS.map((lang) => highlightLines("const x = 1", lang)))
      .catch((e) => console.warn("[highlighter] warmup failed", e));
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => warm());
  else setTimeout(warm, 250);
}

export function inferLangFromPath(path: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  if (!m) return null;
  return resolveLang(m[1]);
}
