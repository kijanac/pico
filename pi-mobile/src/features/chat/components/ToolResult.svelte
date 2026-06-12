<script lang="ts">
  import Anser from "anser";
  import type { ToolCallMessage } from "@pico/protocol";
  import { highlightToHtml, inferLangFromPath } from "@/shared/lib/highlighter";

  const BASH_CLASS =
    "type-code mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[#0d1117] p-2 font-mono text-[#e6edf3] whitespace-pre-wrap break-words";
  const CODE_BLOCK_CLASS =
    "type-code code-wrap mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-2";
  const RAW_CLASS =
    "type-code mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[color:var(--color-fg-muted)] whitespace-pre-wrap break-words";

  let { msg }: { msg: ToolCallMessage } = $props();

  const result = $derived(unwrapContentEnvelope(msg.result ?? ""));
  const contentText = $derived.by(() =>
    msg.resultContent
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") || result,
  );
  const images = $derived(msg.resultContent?.filter((part) => part.type === "image") ?? []);
  const detailsJson = $derived(formatDetails(msg.details));
  const displayText = $derived.by(() => {
    if (msg.status === "error") return contentText;
    if (msg.toolKind === "builtin" && msg.tool === "write") return msg.args.content || contentText;
    return contentText;
  });
  const path = $derived.by(() => (msg.toolKind === "builtin" && (msg.tool === "read" || msg.tool === "write") ? msg.args.path : ""));
  // ANSI parsing is synchronous and re-runs per streaming update, so cap it
  // to the output tail; huge bash logs otherwise stall the main thread.
  const MAX_ANSI_PARSE_CHARS = 32_768;
  const bashHtml = $derived.by(() => {
    let text = displayText;
    let truncated = false;
    if (text.length > MAX_ANSI_PARSE_CHARS) {
      text = text.slice(-MAX_ANSI_PARSE_CHARS);
      const firstNewline = text.indexOf("\n");
      if (firstNewline > 0) text = text.slice(firstNewline + 1);
      truncated = true;
    }
    const escaped = Anser.escapeForHtml(text);
    const html = Anser.ansiToHtml(escaped, { use_classes: false });
    return truncated ? `<span style="opacity:.6">… earlier output omitted …</span>\n${html}` : html;
  });

  let highlightedHtml = $state<string | null>(null);

  $effect(() => {
    const text = displayText;
    const lang = path ? inferLangFromPath(path) : null;
    highlightedHtml = null;
    if (!text || !lang) return;

    let cancelled = false;
    void (async () => {
      try {
        const html = await highlightToHtml(text, lang);
        if (!cancelled) highlightedHtml = html;
      } catch (error) {
        console.warn("[tool-result] highlight failed:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  function formatDetails(details: unknown): string {
    if (details === undefined) return "";
    try {
      return JSON.stringify(details, null, 2) ?? "";
    } catch {
      return String(details);
    }
  }

  function unwrapContentEnvelope(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && "content" in parsed) {
        const content = parsed.content;
        if (Array.isArray(content)) {
          const parts = content
            .map((part) => {
              if (typeof part === "string") return part;
              if (part && typeof part === "object" && "text" in part) {
                return typeof part.text === "string" ? part.text : "";
              }
              return "";
            })
            .filter(Boolean);
          if (parts.length > 0) return parts.join("\n");
        }
      }
    } catch {}

    return text;
  }
</script>

{#if displayText}
  {#if msg.status === "error"}
    <pre class={RAW_CLASS}>{displayText}</pre>
  {:else if msg.toolKind === "builtin" && msg.tool === "bash"}
    {@html `<pre class="${BASH_CLASS}">${bashHtml}</pre>`}
  {:else if highlightedHtml}
    <div class={CODE_BLOCK_CLASS}>{@html highlightedHtml}</div>
  {:else}
    <pre class={RAW_CLASS}>{displayText}</pre>
  {/if}
{/if}

{#if images.length > 0}
  <div class="mt-1 grid gap-2">
    {#each images as image}
      <img class="max-h-72 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] object-contain" src={`data:${image.mimeType};base64,${image.data}`} alt="tool result" />
    {/each}
  </div>
{/if}

{#if detailsJson}
  <details class="type-code mt-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[color:var(--color-fg-muted)]">
    <summary class="cursor-pointer select-none">details</summary>
    <pre class="mt-2 whitespace-pre-wrap break-words">{detailsJson}</pre>
  </details>
{/if}
