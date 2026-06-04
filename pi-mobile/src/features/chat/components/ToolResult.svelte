<script lang="ts">
  import Anser from "anser";
  import type { ToolCallMessage } from "@pi-mobile/protocol";
  import { highlightToHtml, inferLangFromPath } from "@/shared/lib/highlighter";

  const BASH_CLASS =
    "text-code mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[#0d1117] p-2 font-mono text-[#e6edf3] whitespace-pre-wrap break-words";
  const CODE_BLOCK_CLASS =
    "text-code code-wrap mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-2";
  const RAW_CLASS =
    "text-code mt-1 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[color:var(--color-fg-muted)] whitespace-pre-wrap break-words";

  let { msg }: { msg: ToolCallMessage } = $props();

  const result = $derived(unwrapContentEnvelope(msg.result ?? ""));
  const displayText = $derived.by(() => {
    if (msg.status === "error") return result;
    if (msg.toolKind === "builtin" && msg.tool === "write") return msg.args.content || result;
    return result;
  });
  const path = $derived.by(() => (msg.toolKind === "builtin" && (msg.tool === "read" || msg.tool === "write") ? msg.args.path : ""));
  const bashHtml = $derived.by(() => {
    const escaped = Anser.escapeForHtml(displayText);
    return Anser.ansiToHtml(escaped, { use_classes: false });
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

{#if msg.status === "error"}
  <pre class={RAW_CLASS}>{displayText}</pre>
{:else if msg.toolKind === "builtin" && msg.tool === "bash"}
  {@html `<pre class="${BASH_CLASS}">${bashHtml}</pre>`}
{:else if highlightedHtml}
  <div class={CODE_BLOCK_CLASS}>{@html highlightedHtml}</div>
{:else}
  <pre class={RAW_CLASS}>{displayText}</pre>
{/if}
