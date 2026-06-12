<script lang="ts">
  import { Archive, ArchiveRestore, Pencil, Plus, Settings as SettingsIcon, Trash2 } from "@lucide/svelte";
  import type { SessionMeta } from "@pico/protocol";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import PullToRefresh from "@/shared/components/PullToRefresh.svelte";
  import SwipeActionRow from "@/shared/components/SwipeActionRow.svelte";
  import { formatCost, relativeTime } from "@/shared/lib/format";
  import { cwdDisplayName } from "@/shared/lib/path-display";
  import { Button } from "@/shared/ui/button";

  let {
    sessions,
    refreshing,
    error,
    archivedView,
    visibleCount,
    creating = false,
    interactive = true,
    bridgeConfigured = true,
    openSwipeSessionId = $bindable(null),
    onRefresh = async () => {},
    onToggleArchived = () => {},
    onSettings = () => {},
    onSetupBridge = () => {},
    onNewSession = () => {},
    onOpenSession = () => {},
    onRename = () => {},
    onToggleArchive = () => {},
    onDelete = () => {},
  }: {
    sessions: readonly SessionMeta[];
    refreshing: boolean;
    error: string | null;
    archivedView: boolean;
    visibleCount: number;
    creating?: boolean;
    interactive?: boolean;
    bridgeConfigured?: boolean;
    openSwipeSessionId?: string | null;
    onRefresh?: () => Promise<void>;
    onToggleArchived?: () => void | Promise<void>;
    onSettings?: () => void;
    onSetupBridge?: () => void;
    onNewSession?: () => void;
    onOpenSession?: (session: SessionMeta) => void;
    onRename?: (session: SessionMeta) => void;
    onToggleArchive?: (session: SessionMeta) => void | Promise<void>;
    onDelete?: (session: SessionMeta) => void;
  } = $props();

  const SESSION_ACTION_WIDTH = 58;

  function closeOpenSwipeRow(event: Event): void {
    if (!interactive || !openSwipeSessionId) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-swipe-action-row]")) return;
    openSwipeSessionId = null;
  }
</script>

<main
  class="flex min-h-0 flex-1 flex-col pt-[calc(env(safe-area-inset-top)+16px)]"
  ontouchstart={closeOpenSwipeRow}
>
  <header class="flex items-center justify-between gap-3 px-3">
    <div class="flex items-baseline gap-2">
      <h1 class="type-title font-medium">{archivedView ? "archived" : "sessions"}</h1>
      <span class="type-label uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">{visibleCount}</span>
    </div>
    <div class="flex items-center gap-1">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Toggle archived" onclick={() => void onToggleArchived()}>
        {#if archivedView}
          <ArchiveRestore class="size-3.5" />
        {:else}
          <Archive class="size-3.5" />
        {/if}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Settings" onclick={onSettings}>
        <SettingsIcon class="size-3.5" />
      </Button>
    </div>
  </header>

  {#if error && bridgeConfigured}
    <div
      class="type-meta mx-3 mt-4 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[color:var(--color-danger)]"
    >
      {error}
      <button type="button" class="ml-2 underline opacity-70" onclick={() => void onRefresh()}>
        retry
      </button>
    </div>
  {/if}

  <PullToRefresh onRefresh={onRefresh} class="mt-4 min-h-0 flex-1">
    {#if refreshing && sessions.length === 0}
      <section class="type-copy flex min-h-full items-center justify-center text-[color:var(--color-fg-muted)]">loading sessions…</section>
    {:else if sessions.length === 0 && !bridgeConfigured && !archivedView}
      <section class="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div>
          <p class="type-title font-medium">no bridge connected</p>
          <p class="type-copy mt-2 max-w-[34ch] text-[color:var(--color-fg-muted)]">
            pico drives a pi coding agent on your server. connect a bridge to start your first session.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onclick={onSetupBridge}>set up bridge</Button>
      </section>
    {:else if sessions.length === 0}
      <section class="flex min-h-full items-center justify-center px-6 text-center">
        <p class="type-copy max-w-[34ch] text-[color:var(--color-fg-muted)]">
          {archivedView
            ? "no archived sessions."
            : "no sessions yet. a session is one pi conversation in one working directory on your box."}
        </p>
      </section>
    {:else}
      <section class="flex min-h-full flex-col">
        {#each sessions as session (session.id)}
          {#if interactive}
            <SwipeActionRow
              open={openSwipeSessionId === session.id}
              actionWidth={SESSION_ACTION_WIDTH}
              actionCount={3}
              onOpen={() => (openSwipeSessionId = session.id)}
              onClose={() => {
                if (openSwipeSessionId === session.id) openSwipeSessionId = null;
              }}
            >
              {#snippet actions()}
                {@render RowActions(session)}
              {/snippet}

              {@render RowContent(session)}
            </SwipeActionRow>
          {:else}
            <div data-swipe-action-row class="hairline-b relative overflow-hidden bg-[color:var(--color-bg)]">
              <div class="bg-[color:var(--color-bg)]">
                {@render RowContent(session)}
              </div>
            </div>
          {/if}
        {/each}
      </section>
    {/if}
  </PullToRefresh>

  <div class="p-2" style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem)">
    {#if bridgeConfigured}
      <Button
        type="button"
        class="h-10 w-full"
        disabled={creating}
        onclick={onNewSession}
      >
        <Plus class="size-3.5" />
        new session
      </Button>
    {:else}
      <Button type="button" class="h-10 w-full" onclick={onSetupBridge}>
        set up bridge
      </Button>
    {/if}
  </div>
</main>

{#snippet RowActions(session: SessionMeta)}
  <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-surface)] text-[color:var(--color-fg-muted)]" onclick={() => onRename(session)} aria-label="Rename session"><Pencil class="size-4" /></button>
  <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-surface)] text-[color:var(--color-fg-muted)]" onclick={() => void onToggleArchive(session)} aria-label={session.archived ? "Unarchive session" : "Archive session"}>{#if session.archived}<ArchiveRestore class="size-4" />{:else}<Archive class="size-4" />{/if}</button>
  <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-danger)] text-[color:var(--color-bg)]" onclick={() => onDelete(session)} aria-label="Delete session"><Trash2 class="size-4" /></button>
{/snippet}

{#snippet RowContent(session: SessionMeta)}
  <div class="flex items-center gap-2 bg-[color:var(--color-bg)] px-3 py-3 active:bg-[color:var(--color-surface)]">
    <button type="button" class="min-w-0 flex-1 text-left" onclick={() => onOpenSession(session)}>
      <div class="mb-1 flex items-center gap-2">
        <StatusDot status={session.status} />
        <span class="type-title min-w-0 flex-1 truncate">{session.title}</span>
        <span class="type-label uppercase tracking-[0.08em] tabular-nums text-[color:var(--color-fg-faint)]">{relativeTime(session.updatedAt)}</span>
      </div>
      <div class="type-meta flex items-center gap-3 text-[color:var(--color-fg-muted)]">
        <span class="truncate">{cwdDisplayName(session.cwd)}</span>
        <span class="ml-auto shrink-0 tabular-nums">{formatCost(session.costUsd)}</span>
      </div>
    </button>
  </div>
{/snippet}
