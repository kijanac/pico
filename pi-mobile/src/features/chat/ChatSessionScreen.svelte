<script lang="ts">
  import { onMount } from "svelte";
  import { Home } from "@lucide/svelte";
  import type { ContextUsage, SessionStats } from "@pi-mobile/protocol";
  import { navigateTo, routePaths } from "@/app/routes";
  import {
    activeSessionState,
    createChatSessionState,
  } from "@/features/chat/model/chat-session.state.svelte";
  import RetryBanner from "@/features/chat/components/RetryBanner.svelte";
  import MessageList from "@/features/chat/components/MessageList.svelte";
  import InputBar from "@/features/chat/components/InputBar.svelte";
  import SessionAgentActions from "@/features/chat/components/SessionAgentActions.svelte";
  import { getSessionStats } from "@/features/chat/api";
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import { formatCost, formatTokens } from "@/shared/lib/format";
  import { cwdDisplayName } from "@/shared/lib/path-display";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import { Button } from "@/shared/ui/button";
  import EdgeSwipeBack from "@/shared/components/EdgeSwipeBack.svelte";
  import HomePreview from "@/features/sessions/components/HomePreview.svelte";

  let { sessionId }: { sessionId: string } = $props();

  let stats = $state<SessionStats>();
  let statsRequestId = 0;

  const session = $derived(sessionListState.sessions.find((candidate) => candidate.id === sessionId) ?? null);
  const contextStats = $derived(
    stats?.sessionId === sessionId && stats.contextUsage
      ? { cost: stats.cost, usage: stats.contextUsage }
      : undefined,
  );

  onMount(() => {
    const session = createChatSessionState(sessionId);
    void session.start();
    return () => session.stop();
  });

  $effect(() => {
    sessionId;
    activeSessionState.status;
    void loadStats();
  });

  async function loadStats(): Promise<void> {
    const requestId = ++statsRequestId;
    try {
      const next = await getSessionStats(sessionId);
      if (requestId === statsRequestId) stats = next;
    } catch {
    }
  }

  function formatContextUsage(usage: ContextUsage): string {
    const tokens = usage.tokens === null ? "?" : formatTokens(usage.tokens);
    const percent = usage.percent === null ? "" : ` (${Math.round(usage.percent)}%)`;
    return `context ${tokens} / ${formatTokens(usage.contextWindow)}${percent}`;
  }
</script>

<EdgeSwipeBack href="/">
  {#snippet preview()}
    <HomePreview />
  {/snippet}

<main class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
  <header class="flex items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-3 py-[calc(env(safe-area-inset-top)+12px)] pb-3">
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Sessions" title="Sessions" onclick={() => navigateTo(routePaths.sessions)}>
      <Home class="size-3.5" />
    </Button>
    <div class="min-w-0 flex-1">
      {#if session}
        <div class="flex min-w-0 items-center gap-2">
          <StatusDot status={activeSessionState.status} />
          <div class="min-w-0 flex-1">
            <div class="truncate text-[13px] font-medium leading-tight">{session.title}</div>
            <div class="truncate text-[10px] text-[color:var(--color-fg-faint)]">
              {cwdDisplayName(session.cwd)}
            </div>
          </div>
        </div>
      {:else}
        <div class="truncate text-[13px] font-medium leading-tight">session</div>
        <div class="truncate text-[10px] text-[color:var(--color-fg-faint)]">{activeSessionState.connectionStatus}</div>
      {/if}
    </div>
    <div class="flex w-12 justify-end">
      <SessionAgentActions {sessionId} />
    </div>
  </header>

  {#if contextStats}
    <div class="hairline-b flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">
      <span class="truncate">{formatContextUsage(contextStats.usage)}</span>
      <span class="ml-auto shrink-0 tabular-nums text-[color:var(--color-fg-muted)]">{formatCost(contextStats.cost)}</span>
    </div>
  {/if}

  <RetryBanner />
  {#if activeSessionState.connectionStatus === "gone"}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div class="text-[13px] font-medium">session no longer available</div>
      <div class="max-w-[28ch] text-[11px] text-[color:var(--color-fg-muted)]">
        the bridge can't find this session — its on-disk file may have been removed, or the session was started in ephemeral mode.
      </div>
      <Button type="button" variant="outline" size="sm" class="mt-2" onclick={() => navigateTo(routePaths.sessions)}>back to sessions</Button>
    </div>
  {:else}
    <MessageList {sessionId} />
    <InputBar {sessionId} />
  {/if}
</main>
</EdgeSwipeBack>
