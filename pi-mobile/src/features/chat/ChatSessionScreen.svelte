<script lang="ts">
  import { onMount } from "svelte";
  import { Home } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import {
    activeSessionState,
    createChatSessionState,
  } from "@/features/chat/model/chat-session.state.svelte";
  import RetryBanner from "@/features/chat/components/RetryBanner.svelte";
  import MessageList from "@/features/chat/components/MessageList.svelte";
  import InputBar from "@/features/chat/components/InputBar.svelte";
  import SessionAgentActions from "@/features/chat/components/SessionAgentActions.svelte";
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import { formatCost, formatTokens, shortPath } from "@/shared/lib/format";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import { Button } from "@/shared/ui/button";
  import EdgeSwipeBack from "@/shared/components/EdgeSwipeBack.svelte";
  import SessionsPreview from "@/features/sessions/components/SessionsPreview.svelte";

  let { sessionId }: { sessionId: string } = $props();

  const session = $derived(sessionListState.sessions.find((candidate) => candidate.id === sessionId) ?? null);

  onMount(() => {
    const session = createChatSessionState(sessionId);
    void session.start();
    return () => session.stop();
  });
</script>

<EdgeSwipeBack href="/">
  {#snippet preview()}
    <SessionsPreview />
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
              {shortPath(session.cwd, 2)}{session.branch ? ` · ${session.branch}` : ""}
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

  {#if session}
    <div class="hairline-b flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">
      <span>in <span class="tabular-nums text-[color:var(--color-fg-muted)]">{formatTokens(session.tokens.in)}</span></span>
      <span>out <span class="tabular-nums text-[color:var(--color-fg-muted)]">{formatTokens(session.tokens.out)}</span></span>
      <span class="ml-auto tabular-nums text-[color:var(--color-fg-muted)]">{formatCost(session.costUsd)}</span>
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
