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
  import ExtensionUiSheet from "@/features/chat/components/ExtensionUiSheet.svelte";
  import ExtensionNotifications from "@/features/chat/components/ExtensionNotifications.svelte";
  import type { SessionStats } from "@pico/protocol";
  import { getSessionStats } from "@/features/chat/api";
  import { runHost } from "@/shared/lib/rpc-client";
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import { cwdDisplayName } from "@/shared/lib/path-display";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import { Button } from "@/shared/ui/button";
  import EdgeSwipeBack from "@/shared/components/EdgeSwipeBack.svelte";
  import HomePreview from "@/features/sessions/components/HomePreview.svelte";
  import { warmHighlighter } from "@/shared/lib/highlighter";

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
    warmHighlighter();
    return () => session.stop();
  });

  $effect(() => {
    sessionId;
    activeSessionState.status;
    activeSessionState.compacting;
    void loadStats();
  });

  async function loadStats(): Promise<void> {
    const requestId = ++statsRequestId;
    try {
      const next = await runHost(getSessionStats(sessionId));
      if (requestId === statsRequestId) stats = next;
    } catch {
    }
  }
</script>

<EdgeSwipeBack href="/">
  {#snippet preview()}
    <HomePreview />
  {/snippet}

<main class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
  <header class="flex items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-3 py-[calc(env(safe-area-inset-top)+12px)] pb-3">
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Sessions" title="Sessions" onclick={() => navigateTo(routePaths.sessions, "pop")}>
      <Home class="size-3.5" />
    </Button>
    <div class="min-w-0 flex-1">
      {#if session}
        <div class="flex min-w-0 items-center gap-2">
          <StatusDot status={activeSessionState.status} />
          <div class="min-w-0 flex-1">
            <div class="type-title truncate font-medium">{session.title}</div>
            <div class="type-label uppercase tracking-[0.08em] truncate text-[color:var(--color-fg-faint)]">
              {cwdDisplayName(session.cwd)}
            </div>
          </div>
        </div>
      {:else}
        <div class="type-title truncate font-medium">session</div>
        <div class="type-label uppercase tracking-[0.08em] truncate text-[color:var(--color-fg-faint)]">{activeSessionState.connectionStatus}</div>
      {/if}
    </div>
    <div class="flex w-12 justify-end">
      <SessionAgentActions {sessionId} />
    </div>
  </header>

  <RetryBanner />
  {#if activeSessionState.connectionStatus === "gone"}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div class="type-title font-medium">session no longer available</div>
      <div class="type-copy max-w-[28ch] text-[color:var(--color-fg-muted)]">
        the Pico host can't find this session — its on-disk file may have been removed, or the session was started in ephemeral mode.
      </div>
      <Button type="button" variant="outline" size="sm" class="mt-2" onclick={() => navigateTo(routePaths.sessions, "pop")}>back to sessions</Button>
    </div>
  {:else}
    <MessageList {sessionId} />
    <ExtensionNotifications />
    <InputBar {sessionId} {contextStats} />
  {/if}
  <ExtensionUiSheet />
</main>
</EdgeSwipeBack>
