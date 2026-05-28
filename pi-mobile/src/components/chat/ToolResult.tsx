import {
  createResource,
  createMemo,
  Show,
  type JSX,
} from "solid-js";
import Anser from "anser";
import type { ToolCallMessage } from "@pi-mobile/protocol";
import { highlightToHtml, inferLangFromPath } from "~/lib/highlighter";

/**
 * Per-tool result renderers.
 *
 *   bash   — ANSI escapes converted to inline-styled HTML via anser.
 *   read   — Shiki-highlighted file content, language inferred from args.path.
 *   write  — Same as read but rendering args.content when available.
 *   edit   — Handled by EditDiff at the ToolCall level.
 *   custom — Raw result text.
 */

const BASH_CLASS =
  "mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[#0d1117] p-2 font-mono text-[11px] leading-[1.5] text-[#e6edf3] whitespace-pre-wrap break-words";

const CODE_BLOCK_CLASS =
  "code-wrap mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-2 text-[11px] leading-[1.5]";

const RAW_CLASS =
  "mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[11px] leading-[1.5] text-[color:var(--color-fg-muted)] whitespace-pre-wrap break-words";

/* ── bash ─────────────────────────────────────────────────────────── */

function BashResult(props: { result: string }): JSX.Element {
  // Memoize — anser is fast but the result string may be long.
  const html = createMemo(() => {
    const escaped = Anser.escapeForHtml(props.result);
    return Anser.ansiToHtml(escaped, { use_classes: false });
  });
  // eslint-disable-next-line solid/no-innerhtml
  return <pre class={BASH_CLASS} innerHTML={html()} />;
}

/* ── read / write ─────────────────────────────────────────────────── */

function HighlightedResult(props: {
  text: string;
  path: string;
}): JSX.Element {
  const lang = createMemo(() => inferLangFromPath(props.path));

  // createResource handles the async shiki render. While loading or on
  // failure, fall back to a plain <pre> so the user sees content
  // immediately rather than a blank box.
  const [html] = createResource(
    () => ({ text: props.text, lang: lang() }),
    async ({ text, lang }) => {
      if (!text) return null;
      try {
        return await highlightToHtml(text, lang);
      } catch (e) {
        console.warn("[tool-result] highlight failed:", e);
        return null;
      }
    },
  );

  return (
    <Show
      when={html()}
      fallback={<pre class={RAW_CLASS}>{props.text}</pre>}
    >
      {/* shiki produces <pre><code> with inline styles, so the wrapper
          only carries border/spacing/scroll affordances. */}
      <div
        class={CODE_BLOCK_CLASS}
        // eslint-disable-next-line solid/no-innerhtml
        innerHTML={html() ?? ""}
      />
    </Show>
  );
}

/* ── raw fallback ─────────────────────────────────────────────────── */

function RawResult(props: { text: string }): JSX.Element {
  return <pre class={RAW_CLASS}>{props.text}</pre>;
}

function unwrapContentEnvelope(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && "content" in parsed) {
      const content = (parsed as { content?: unknown }).content;
      if (Array.isArray(content)) {
        const parts = content
          .map((part) => {
            if (typeof part === "string") return part;
            if (
              part &&
              typeof part === "object" &&
              "text" in part &&
              typeof (part as { text?: unknown }).text === "string"
            ) {
              return (part as { text: string }).text;
            }
            return "";
          })
          .filter(Boolean);
        if (parts.length > 0) return parts.join("\n");
      }
    }
  } catch {
    // Not JSON — render the original text.
  }

  return text;
}

/* ── dispatcher ───────────────────────────────────────────────────── */

export default function ToolResult(props: {
  msg: ToolCallMessage;
}): JSX.Element {
  // Error results are best shown raw and red — syntax-highlighting an
  // error trace or partial output just adds noise.
  const isError = () => props.msg.status === "error";
  const result = () => unwrapContentEnvelope(props.msg.result ?? "");

  return (
    <Show when={!isError()} fallback={<RawResult text={result()} />}>
      <ToolResultContent msg={props.msg} result={result()} />
    </Show>
  );
}

function ToolResultContent(props: {
  msg: ToolCallMessage;
  result: string;
}): JSX.Element {
  if (props.msg.toolKind === "custom") {
    return <RawResult text={props.result} />;
  }

  switch (props.msg.tool) {
    case "bash":
      return <BashResult result={props.result} />;
    case "read":
      return <HighlightedResult text={props.result} path={props.msg.args.path} />;
    case "write":
      return (
        <HighlightedResult
          text={props.msg.args.content || props.result}
          path={props.msg.args.path}
        />
      );
    case "edit":
      return <RawResult text={props.result} />;
  }
}
