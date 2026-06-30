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
  import { runOnHost } from "@/shared/lib/rpc-client";
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import { cwdDisplayName } from "@/shared/lib/path-display";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import { Button } from "@/shared/ui/button";
  import EdgeSwipeBack from "@/shared/components/EdgeSwipeBack.svelte";
  import HomePreview from "@/features/sessions/components/HomePreview.svelte";
  import { warmHighlighter } from "@/shared/lib/highlighter";
  import { markSessionOpen } from "@/shared/lib/session-open-timing";

  let { hostId, sessionId }: { hostId: string; sessionId: string } = $props();
  const timingId = $derived(`${hostId}:${sessionId}`);

  let stats = $state<SessionStats>();
  let composerHeight = $state(0);
  let forceUnknownContext = $state(false);
  let invalidatedAtUsageVersion = 0;
  let statsRequestId = 0;
  let lastContextUsageInvalidationVersion = activeSessionState.contextUsageInvalidationVersion;

  const sessionItem = $derived(sessionListState.sessions.find((candidate) => candidate.hostId === hostId && candidate.session.id === sessionId) ?? null);
  const session = $derived(sessionItem?.session ?? null);
  const contextStats = $derived.by(() => {
    if (stats?.sessionId !== sessionId || !stats.contextUsage) return undefined;
    return {
      cost: stats.cost,
      usage: forceUnknownContext
        ? { ...stats.contextUsage, tokens: null, percent: null }
        : stats.contextUsage,
    };
  });

  onMount(() => {
    markSessionOpen(timingId, "route-mounted");
    const session = createChatSessionState(hostId, sessionId);
    void session.start();
    warmHighlighter();
    return () => session.stop();
  });

  $effect(() => {
    const version = activeSessionState.contextUsageInvalidationVersion;
    if (version === lastContextUsageInvalidationVersion) return;
    lastContextUsageInvalidationVersion = version;
    forceUnknownContext = true;
    invalidatedAtUsageVersion = activeSessionState.contextUsageVersion;
    void loadStats();
  });

  $effect(() => {
    hostId;
    sessionId;
    activeSessionState.contextUsageVersion;
    void loadStats();
  });

  async function loadStats(): Promise<void> {
    const requestId = ++statsRequestId;
    try {
      const next = await runOnHost(hostId, getSessionStats(sessionId));
      if (requestId === statsRequestId) {
        stats = next;
        if (
          forceUnknownContext &&
          activeSessionState.contextUsageVersion > invalidatedAtUsageVersion &&
          next.contextUsage &&
          next.contextUsage.percent !== null
        ) {
          forceUnknownContext = false;
        }
      }
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
              {cwdDisplayName(session.cwd)}{#if sessionItem} · {sessionItem.hostName}{/if}
            </div>
          </div>
        </div>
      {:else}
        <div class="type-title truncate font-medium">session</div>
        <div class="type-label uppercase tracking-[0.08em] truncate text-[color:var(--color-fg-faint)]">{activeSessionState.connectionStatus}</div>
      {/if}
    </div>
    <div class="flex w-12 justify-end">
      <SessionAgentActions {hostId} {sessionId} />
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
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <MessageList {hostId} {sessionId} bottomInset={composerHeight} />
      <div
        class="composer-scroll-scrim pointer-events-none absolute inset-x-0 bottom-0 z-10"
        style={`height: calc(${composerHeight}px + 4rem)`}
        aria-hidden="true"
      ></div>
      <div bind:clientHeight={composerHeight} class="pointer-events-none absolute inset-x-0 bottom-0 z-30">
        <ExtensionNotifications />
        <InputBar {hostId} {sessionId} {contextStats} />
      </div>
    </div>
  {/if}
  <ExtensionUiSheet />
</main>
</EdgeSwipeBack>
