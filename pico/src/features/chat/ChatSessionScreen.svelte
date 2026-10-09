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
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import { cwdDisplayName } from "@/shared/lib/path-display";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import { Button } from "@/shared/ui/button";
  import { warmHighlighter } from "@/shared/lib/highlighter";
  import { markSessionOpen } from "@/shared/lib/session-open-timing";

  let { sessionId }: { sessionId: string } = $props();
  const timingId = $derived(sessionId);

  // Shared with the session info sheet.
  const stats = $derived(activeSessionState.stats.value);
  let composerHeight = $state(0);
  let forceUnknownContext = $state(false);
  let invalidatedAtUsageVersion = 0;
  let lastContextUsageInvalidationVersion = activeSessionState.contextUsageInvalidationVersion;

  const session = $derived(sessionListState.sessions.find((candidate) => candidate.id === sessionId) ?? null);
  const contextStats = $derived.by(() => {
    if (stats?.sessionId !== sessionId || !stats.contextUsage) return undefined;
    return {
      cost: stats.cost,
      usage: forceUnknownContext
        ? { ...stats.contextUsage, tokens: null, percent: null }
        : stats.contextUsage,
    };
  });
  const statusDotTone = $derived(
    activeSessionState.status === "thinking" || activeSessionState.status === "tool"
      ? "accent"
      : activeSessionState.status === "waiting"
        ? "warn"
        : activeSessionState.status === "error"
          ? "danger"
          : "muted",
  );
  const connectionLabel = $derived(
    {
      offline: "offline",
      connecting: "connecting…",
      reconnecting: "reconnecting…",
      connected: null,
      gone: "gone",
    }[activeSessionState.connectionStatus],
  );
  const statusDotActive = $derived(activeSessionState.status === "thinking" || activeSessionState.status === "tool");

  onMount(() => {
    markSessionOpen(timingId, "route-mounted");
    const session = createChatSessionState(sessionId);
    session.start();
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
    sessionId;
    activeSessionState.contextUsageVersion;
    void loadStats();
  });

  async function loadStats(): Promise<void> {
    try {
      const next = await activeSessionState.stats.load(sessionId);
      if (
        next &&
        forceUnknownContext &&
        activeSessionState.contextUsageVersion > invalidatedAtUsageVersion &&
        next.contextUsage &&
        next.contextUsage.percent !== null
      ) {
        forceUnknownContext = false;
      }
    } catch {
    }
  }
</script>

<main class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
  <header class="border-b border-[color:var(--color-border)]">
    <div class="column flex items-center justify-between gap-3 px-3 py-[calc(env(safe-area-inset-top)+12px)] pb-3">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Sessions" title="Sessions" onclick={() => navigateTo(routePaths.sessions, "pop")}>
        <Home class="size-3.5" />
      </Button>
      <div class="min-w-0 flex-1">
        {#if session}
          <div class="flex min-w-0 items-center gap-2">
            <StatusDot tone={statusDotTone} active={statusDotActive} label={activeSessionState.status} />
            <div class="min-w-0 flex-1">
              <div class="type-title font-prose truncate font-medium">{session.title}</div>
              <!-- Until caught up, what the connection is doing instead of the folder. -->
              <div class="type-label uppercase tracking-[0.08em] truncate text-[color:var(--color-fg-faint)]" aria-live="polite">
                {connectionLabel ?? cwdDisplayName(session.cwd)}
              </div>
            </div>
          </div>
        {:else}
          <div class="type-title font-prose truncate font-medium">session</div>
          <div class="type-label uppercase tracking-[0.08em] truncate text-[color:var(--color-fg-faint)]">{connectionLabel ?? "connected"}</div>
        {/if}
      </div>
      <div class="flex w-12 justify-end">
        <SessionAgentActions {sessionId} />
      </div>
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
      <MessageList {sessionId} bottomInset={composerHeight} />
      <div
        class="composer-scroll-scrim pointer-events-none absolute inset-x-0 bottom-0 z-10"
        style={`height: ${composerHeight}px`}
        aria-hidden="true"
      ></div>
      <div bind:clientHeight={composerHeight} class="column pointer-events-none absolute inset-x-0 bottom-0 z-30">
        <ExtensionNotifications />
        <InputBar {sessionId} {contextStats} />
      </div>
    </div>
  {/if}
  <ExtensionUiSheet />
</main>
