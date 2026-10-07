<script lang="ts">
  import { Check, ChevronDown, Loader2 } from "@lucide/svelte";
  import type { CompactionEntry } from "@pico/protocol";
  import { formatTokens } from "@/shared/lib/format";
  import StreamingMarkdown from "@/features/chat/components/StreamingMarkdown.svelte";

  let { msg }: { msg: CompactionEntry } = $props();

  let open = $state(false);

  const hasSummary = $derived(Boolean(msg.summary?.trim()));
  const title = $derived(msg.status === "running" ? "compacting context…" : "context compacted");
  const detail = $derived(msg.tokensBefore !== undefined ? `${formatTokens(msg.tokensBefore)} before compaction` : undefined);
</script>

<div class="px-3 py-1">
  <button
    type="button"
    onclick={() => {
      if (hasSummary) open = !open;
    }}
    aria-expanded={hasSummary ? open : undefined}
    class={`type-meta group flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 py-1.5 text-left ${hasSummary ? "active:bg-[color:var(--color-surface-2)]" : "cursor-default"}`}
  >
    <span class="flex h-4 w-4 items-center justify-center">
      {#if msg.status === "running"}
        <Loader2 class="size-3 animate-spin text-[color:var(--color-accent)]" />
      {:else}
        <Check class="size-3 text-[color:var(--color-fg-faint)]" />
      {/if}
    </span>
    <span class="type-label uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">context</span>
    <span class="min-w-0 flex-1 truncate text-[color:var(--color-fg)]">{title}</span>
    {#if detail}
      <span class="type-label uppercase tracking-[0.08em] hidden max-w-[42%] truncate text-[color:var(--color-fg-faint)] tabular-nums min-[380px]:block">{detail}</span>
    {/if}
    {#if hasSummary}
      <ChevronDown class={`size-3 text-[color:var(--color-fg-faint)] transition-transform ${open ? "rotate-180" : ""}`} />
    {/if}
  </button>

  {#if open && msg.summary}
    <div class="type-copy mt-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[color:var(--color-fg)]">
      <div class="type-label uppercase tracking-[0.08em] mb-1 text-[color:var(--color-fg-faint)]">compaction summary</div>
      <StreamingMarkdown text={msg.summary} done={true} class="type-copy" />
    </div>
  {/if}
</div>
