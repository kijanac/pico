<script lang="ts">
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { formatCost, formatTokens } from "@/shared/lib/format";

  let { sessionId }: { sessionId: string } = $props();

  // Shared with the chat header: shown at once if loaded, refreshed on open.
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
  {#if error}<div class="type-copy text-[color:var(--color-danger)]">{error}</div>{/if}
  {#if stats}
    <div class="type-copy space-y-2">
      {@render InfoRow("session id", stats.sessionId)}
      {@render InfoRow("file", stats.sessionFile ?? "not saved yet")}
      {@render InfoRow("cwd", stats.cwd)}
      {@render InfoRow("messages", String(stats.totalMessages))}
      {@render InfoRow("user / assistant", `${stats.userMessages} / ${stats.assistantMessages}`)}
      {@render InfoRow("tools", `${stats.toolCalls} calls · ${stats.toolResults} results`)}
      {@render InfoRow("tokens", `${formatTokens(stats.tokens.total)} total · ${formatTokens(stats.tokens.input)} in · ${formatTokens(stats.tokens.output)} out`)}
      {@render InfoRow("cache", `${formatTokens(stats.tokens.cacheRead)} read · ${formatTokens(stats.tokens.cacheWrite)} write`)}
      {@render InfoRow("cost", formatCost(stats.cost))}
      {#if stats.contextUsage?.tokens !== null && stats.contextUsage}
        {@render InfoRow("context", `${formatTokens(stats.contextUsage.tokens!)} / ${formatTokens(stats.contextUsage.contextWindow)}${formatContextPercent(stats.contextUsage.percent)}`)}
      {/if}
    </div>
  {/if}
</div>

{#snippet InfoRow(label: string, value: string)}
  <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2">
    <div class="label">{label}</div>
    <div class="mt-1 break-words text-[color:var(--color-fg)]">{value}</div>
  </div>
{/snippet}
