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
      engine: shiki.createJavaScriptRegexEngine(),
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

// Each line as HTML token spans carrying both themes' colors as CSS variables.
export async function highlightLines(
  code: string,
  langHint: string | null | undefined,
): Promise<string[] | null> {
  const lang = resolveLang(langHint);
  if (!lang) return null;

  const ok = await ensureLang(lang);
  if (!ok) return null;

  try {
    const { shiki, primitive } = await getHighlighter();
    const { tokens } = shiki.codeToTokens(primitive, code, {
      lang,
      themes: SHIKI_THEMES,
      defaultColor: DEFAULT_COLOR,
    });
    return tokens.map((line) =>
      line
        .map((t) => `<span class="code-token"${shikiTokenStyleAttr(t.htmlStyle)}>${escapeHtml(t.content)}</span>`)
        .join(""),
    );
  } catch (e) {
    console.warn("[highlighter] codeToTokens failed", lang, e);
    return null;
  }
}

// A whole block, in the same pre.shiki > code > span.line shape as Shiki's codeToHtml.
export async function highlightToHtml(
  code: string,
  langHint: string | null | undefined,
): Promise<string | null> {
  const lines = await highlightLines(code, langHint);
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
