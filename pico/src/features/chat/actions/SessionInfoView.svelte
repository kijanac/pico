<script lang="ts">
  import { ChevronDown, Download } from "@lucide/svelte";
  import ActionRow from "@/shared/components/ActionRow.svelte";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { formatCost, formatTokens } from "@/shared/lib/format";

  let { sessionId, onExport, exporting }: { sessionId: string; onExport: () => void; exporting: boolean } = $props();

  const stats = $derived(activeSessionState.stats.value);
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    sessionId;
    void loadStats();
  });

  async function loadStats(): Promise<void> {
    loading = true;
    error = null;
    try {
      await activeSessionState.stats.load(sessionId);
    } catch (caught) {
      error = String(caught);
    } finally {
      loading = false;
    }
  }

  function formatContextPercent(percent: number | null): string {
    return percent === null ? "" : ` · ${Math.round(percent)}%`;
  }
</script>

<div class="flex-1 overflow-y-auto px-3 py-3">
  {#if loading && !stats}<div class="type-copy text-[color:var(--color-fg-muted)]">loading session info…</div>{/if}
  {#if error}<div class="type-copy text-[color:var(--color-danger)]" role="alert">{error}</div>{/if}
  {#if stats}
    <dl class="type-copy space-y-2">
      {@render InfoRow("workspace", stats.cwd)}
      {@render InfoRow("cost", formatCost(stats.cost))}
      {@render InfoRow("messages", String(stats.totalMessages))}
      {@render InfoRow("tool calls", String(stats.toolCalls))}
    </dl>
    <details class="group mt-3 border-t border-[color:var(--color-border)]">
      <summary class="type-copy flex min-h-11 cursor-pointer list-none items-center justify-between text-[color:var(--color-fg-muted)] focus-visible:outline focus-visible:outline-[color:var(--color-accent)] [&::-webkit-details-marker]:hidden">
        <span>details</span>
        <ChevronDown class="size-4 group-open:rotate-180" />
      </summary>
      <dl class="type-copy space-y-2 pb-3">
        {@render InfoRow("session id", stats.sessionId)}
        {@render InfoRow("session file", stats.sessionFile ?? "not saved yet")}
        {@render InfoRow("user messages", String(stats.userMessages))}
        {@render InfoRow("assistant messages", String(stats.assistantMessages))}
        {@render InfoRow("tool results", String(stats.toolResults))}
        {@render InfoRow("total tokens", formatTokens(stats.tokens.total))}
        {@render InfoRow("input tokens", formatTokens(stats.tokens.input))}
        {@render InfoRow("output tokens", formatTokens(stats.tokens.output))}
        {@render InfoRow("cache read", formatTokens(stats.tokens.cacheRead))}
        {@render InfoRow("cache write", formatTokens(stats.tokens.cacheWrite))}
        {@render InfoRow("current context", stats.contextUsage?.tokens !== null && stats.contextUsage ? `${formatTokens(stats.contextUsage.tokens)} / ${formatTokens(stats.contextUsage.contextWindow)}${formatContextPercent(stats.contextUsage.percent)}` : "unavailable")}
      </dl>
    </details>
  {/if}
  <ActionRow variant="card" disabled={exporting} onclick={onExport} class="min-h-11">
    <Download class="size-4 text-[color:var(--color-fg-muted)]" />
    <span class="type-copy">{exporting ? "preparing export…" : "export HTML"}</span>
  </ActionRow>
</div>

{#snippet InfoRow(label: string, value: string)}
  <div class="flex items-baseline justify-between gap-4">
    <dt class="shrink-0 text-[color:var(--color-fg-muted)]">{label}</dt>
    <dd class="min-w-0 text-right tabular-nums text-[color:var(--color-fg)] [overflow-wrap:anywhere]">{value}</dd>
  </div>
{/snippet}
