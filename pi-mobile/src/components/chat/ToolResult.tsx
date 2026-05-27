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
 *            Preserves color and decoration from `ls --color`, error
 *            traces with red, etc.
 *   read   — Shiki-highlighted file content, language inferred from
 *            the file extension in args.path.
 *   write  — Same as read but rendering the content that was written.
 *            Pi puts the written body in args.content, not result, so
 *            we prefer that source.
 *   edit   — Handled by EditDiff at the ToolCall level; this file is
 *            never asked to render an edit's result.
 *   other  — Raw <pre> fallback (glob, grep, custom tools, etc).
 *
 * All viewers are guarded against missing data and gracefully degrade
 * to the raw text view if syntax detection fails.
 */

const BASH_CLASS =
  "mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[#0d1117] p-2 font-mono text-[11px] leading-[1.5] text-[#e6edf3] whitespace-pre-wrap break-words";

const CODE_BLOCK_CLASS =
  "mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-2 text-[11px] leading-[1.5]";

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

/* ── dispatcher ───────────────────────────────────────────────────── */

export default function ToolResult(props: {
  msg: ToolCallMessage;
}): JSX.Element {
  // Error results are best shown raw and red — syntax-highlighting an
  // error trace or partial output just adds noise.
  const isError = () => props.msg.status === "error";

  return (
    <Show when={!isError()} fallback={<RawResult text={props.msg.result ?? ""} />}>
      <Show
        when={props.msg.tool === "bash"}
        fallback={
          <Show
            when={props.msg.tool === "read" || props.msg.tool === "write"}
            fallback={<RawResult text={props.msg.result ?? ""} />}
          >
            <HighlightedResult
              text={
                props.msg.tool === "write"
                  ? (String(props.msg.args.content ?? "") ||
                    (props.msg.result ?? ""))
                  : (props.msg.result ?? "")
              }
              path={String(props.msg.args.path ?? "")}
            />
          </Show>
        }
      >
        <BashResult result={props.msg.result ?? ""} />
      </Show>
    </Show>
  );
}
