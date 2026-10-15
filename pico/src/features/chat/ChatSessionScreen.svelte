<script lang="ts">
  import { onMount } from "svelte";
  import { Folder, Home, Info, Settings } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import {
    activeSessionState,
    createChatSessionState,
  } from "@/features/chat/model/chat-session.state.svelte";
  import RetryBanner from "@/features/chat/components/RetryBanner.svelte";
  import ElsewhereBanner from "@/features/chat/components/ElsewhereBanner.svelte";
  import MessageList from "@/features/chat/components/MessageList.svelte";
  import InputBar from "@/features/chat/components/InputBar.svelte";
  import ContextRing from "@/features/chat/components/ContextRing.svelte";
  import SessionAgentActions from "@/features/chat/components/SessionAgentActions.svelte";
  import ExtensionUiSheet from "@/features/chat/components/ExtensionUiSheet.svelte";
  import ExtensionNotifications from "@/features/chat/components/ExtensionNotifications.svelte";
  import FileSheet from "@/features/chat/files/FileSheet.svelte";
  import ImageSheet from "@/features/chat/files/ImageSheet.svelte";
  import { provideImageOpener, type ImageRequest } from "@/features/chat/files/image-preview";
  import { provideFileOpener, type FileRequest } from "@/features/chat/files/file-links";
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import { Button } from "@/shared/ui/button";
  import { warmHighlighter } from "@/shared/lib/highlighter";
  import { markSessionOpen } from "@/shared/lib/session-open-timing";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";

  let { sessionId }: { sessionId: string } = $props();
  const timingId = $derived(sessionId);

  let agentActions = $state<ReturnType<typeof SessionAgentActions>>();

  const stats = $derived(activeSessionState.stats.value);
  let composerHeight = $state(0);
  let forceUnknownContext = $state(false);
  let invalidatedAtUsageVersion = 0;
  let lastContextUsageInvalidationVersion = activeSessionState.contextUsageInvalidationVersion;

  const session = $derived(activeSessionState.session ?? sessionListState.sessions.find((candidate) => candidate.id === sessionId) ?? null);

  let compactOpen = $state(false);
  let filesOpen = $state(false);
  let fileRequest = $state<FileRequest | null>(null);
  let imageRequest = $state<ImageRequest | null>(null);
  provideImageOpener((image, label) => (imageRequest = { image: { ...image }, label }));
  provideFileOpener((path, edit) => {
    fileRequest = { path, edit, relativeTo: session?.cwd };
    filesOpen = true;
  });
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
    <div class="column grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1 px-3 py-[calc(env(safe-area-inset-top)+12px)] pb-3">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Sessions" title="Sessions" onclick={() => navigateTo(routePaths.sessions, "pop")}>
        <Home size={20} class="size-5" />
      </Button>
      <div class="flex min-h-11 min-w-0 items-center gap-2 max-[360px]:col-span-2">
        {#if session}<StatusDot tone={statusDotTone} active={statusDotActive} label={activeSessionState.status} />{/if}
        <div class="min-w-0 flex-1">
          <div class="type-title font-prose break-words font-medium" class:line-clamp-2={connectionLabel === null} class:truncate={connectionLabel !== null} title={session?.title ?? "session"}>{session?.title ?? "session"}</div>
          {#if connectionLabel}
            <div class="type-label truncate uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]" role="status">{connectionLabel}</div>
          {/if}
        </div>
      </div>
      <div class="col-start-3 row-start-1 flex items-center justify-self-end text-[color:var(--color-fg-muted)] max-[360px]:col-span-2 max-[360px]:col-start-2 max-[360px]:row-start-2">
        <SessionAgentActions bind:this={agentActions} {sessionId} />
        <Button type="button" variant="ghost" size="icon" class="size-11" aria-label="Files" title="files" onclick={() => { fileRequest = null; filesOpen = true; }}><Folder size={20} class="size-5" /></Button>
        <Button type="button" variant="ghost" size="icon" class="size-11" aria-label="Session info" title="session info" onclick={() => agentActions?.showView("info")}><Info size={20} class="size-5" /></Button>
        <Button type="button" variant="ghost" size="icon" class="size-11" aria-label="Session settings" title="session settings" onclick={() => agentActions?.showView("settings")}><Settings size={20} class="size-5" /></Button>
        <ContextRing percent={contextStats?.usage.percent} onCompact={() => (compactOpen = true)} />
      </div>
    </div>
  </header>

  <RetryBanner />
  <ElsewhereBanner onShowTree={() => agentActions?.showView("tree")} />
  {#if !chatLogState.outboxSaved}
    <p role="alert" class="type-meta border-b border-[color:var(--color-border)] px-3 py-2 text-[color:var(--color-danger)]">unsent messages couldn't be saved on this device · keep this page open</p>
  {/if}
  {#if activeSessionState.connectionStatus === "gone"}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div class="type-title font-medium">session no longer available</div>
      <div class="type-copy max-w-[28ch] text-[color:var(--color-fg-muted)]">
        the Pico host can't find this session — its file may have been deleted.
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
        <InputBar {sessionId} {contextStats} bind:compactOpen />
      </div>
    </div>
  {/if}
  <ExtensionUiSheet />
  <FileSheet bind:open={filesOpen} bind:request={fileRequest} cwd={session?.cwd} />
  <ImageSheet bind:request={imageRequest} />
</main>
