<script lang="ts">
  import { Archive, ArchiveRestore, Pencil, Plus, Settings as SettingsIcon, Trash2 } from "@lucide/svelte";
  import HostIssuePanel from "@/shared/components/HostIssuePanel.svelte";
  import type { SessionMeta } from "@pico/protocol";
  import type { HostIssue } from "@/shared/lib/host-issues";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import PullToRefresh from "@/shared/components/PullToRefresh.svelte";
  import SwipeActionRow from "@/shared/components/SwipeActionRow.svelte";
  import { formatCost, relativeTime } from "@/shared/lib/format";
  import { cwdDisplayName } from "@/shared/lib/path-display";
  import { Button } from "@/shared/ui/button";

  let {
    sessions,
    refreshing,
    error = null,
    archivedView,
    creating = false,
    interactive = true,
    openSwipeSessionId = $bindable(null),
    onRefresh = async () => {},
    onToggleArchived = () => {},
    onSettings = () => {},
    onNewSession = () => {},
    onOpenSession = () => {},
    onRename = () => {},
    onToggleArchive = () => {},
    onDelete = () => {},
  }: {
    sessions: readonly SessionMeta[];
    refreshing: boolean;
    error?: HostIssue | null;
    archivedView: boolean;
    creating?: boolean;
    interactive?: boolean;
    openSwipeSessionId?: string | null;
    onRefresh?: () => Promise<void>;
    onToggleArchived?: () => void | Promise<void>;
    onSettings?: () => void;
    onNewSession?: () => void;
    onOpenSession?: (session: SessionMeta) => void;
    onRename?: (session: SessionMeta) => void;
    onToggleArchive?: (session: SessionMeta) => void | Promise<void>;
    onDelete?: (session: SessionMeta) => void;
  } = $props();

  type DotTone = "muted" | "accent" | "warn" | "danger";

  const SESSION_ACTION_WIDTH = 58;

  function sessionStatusTone(status: SessionMeta["status"]): DotTone {
    if (status === "thinking" || status === "tool") return "accent";
    if (status === "waiting") return "warn";
    if (status === "error") return "danger";
    return "muted";
  }

  function sessionStatusActive(status: SessionMeta["status"]): boolean {
    return status === "thinking" || status === "tool";
  }

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
  <header class="column flex items-center justify-between gap-3 px-3">
    <div class="flex items-baseline gap-2">
      <h1 class="type-title font-prose font-medium">{archivedView ? "archived" : "sessions"}</h1>
      <span class="type-label uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">{sessions.length}</span>
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

  {#if error && sessions.length > 0}
    <div class="column mt-4 px-3">
      <HostIssuePanel issue={error} compact>
        {#snippet action()}
          <button type="button" class="type-meta underline text-[color:var(--color-fg-muted)] active:opacity-70" onclick={() => void onRefresh()}>
            retry
          </button>
        {/snippet}
      </HostIssuePanel>
    </div>
  {/if}

  <PullToRefresh onRefresh={onRefresh} class="mt-4 min-h-0 flex-1">
    {#if refreshing && sessions.length === 0}
      <section class="type-copy flex min-h-full items-center justify-center text-[color:var(--color-fg-muted)]">loading sessions…</section>
    {:else if error && sessions.length === 0}
      <section class="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <HostIssuePanel issue={error} class="max-w-sm" />
        <Button type="button" variant="outline" size="sm" onclick={() => void onRefresh()}>retry</Button>
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
      <section class="column flex min-h-full flex-col">
        {#each sessions as item (item.id)}
          {#if interactive}
            <SwipeActionRow
              open={openSwipeSessionId === item.id}
              actionWidth={SESSION_ACTION_WIDTH}
              actionCount={3}
              onOpen={() => (openSwipeSessionId = item.id)}
              onClose={() => {
                if (openSwipeSessionId === item.id) openSwipeSessionId = null;
              }}
            >
              {#snippet actions()}
                {@render RowActions(item)}
              {/snippet}

              {@render RowContent(item)}
            </SwipeActionRow>
          {:else}
            <div data-swipe-action-row class="hairline-b relative overflow-hidden bg-[color:var(--color-bg)]">
              <div class="bg-[color:var(--color-bg)]">
                {@render RowContent(item)}
              </div>
            </div>
          {/if}
        {/each}
      </section>
    {/if}
  </PullToRefresh>

  <div class="column p-2" style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem)">
    <Button
      type="button"
      class="h-10 w-full"
      disabled={creating}
      onclick={onNewSession}
    >
      <Plus class="size-3.5" />
      new session
    </Button>
  </div>
</main>

{#snippet RowActions(item: SessionMeta)}
  <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-surface)] text-[color:var(--color-fg-muted)]" onclick={() => onRename(item)} aria-label="Rename session"><Pencil class="size-4" /></button>
  <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-surface)] text-[color:var(--color-fg-muted)]" onclick={() => void onToggleArchive(item)} aria-label={item.archived ? "Unarchive session" : "Archive session"}>{#if item.archived}<ArchiveRestore class="size-4" />{:else}<Archive class="size-4" />{/if}</button>
  <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-danger)] text-[color:var(--color-bg)]" onclick={() => onDelete(item)} aria-label="Delete session"><Trash2 class="size-4" /></button>
{/snippet}

{#snippet RowContent(item: SessionMeta)}
  <div class="flex items-center gap-2 bg-[color:var(--color-bg)] px-3 py-3 active:bg-[color:var(--color-surface)]">
    <button type="button" class="min-w-0 flex-1 text-left" onclick={() => onOpenSession(item)}>
      <div class="mb-1 flex items-center gap-2">
        <StatusDot tone={sessionStatusTone(item.status)} active={sessionStatusActive(item.status)} label={item.status} />
        <span class="type-title font-prose min-w-0 flex-1 truncate">{item.title}</span>
        <span class="type-label uppercase tracking-[0.08em] tabular-nums text-[color:var(--color-fg-faint)]">{relativeTime(item.updatedAt)}</span>
      </div>
      <div class="type-meta flex items-center gap-3 text-[color:var(--color-fg-muted)]">
        <span class="min-w-0 flex-1 truncate">{cwdDisplayName(item.cwd)}</span>
        <span class="shrink-0 tabular-nums">{formatCost(item.costUsd)}</span>
      </div>
    </button>
  </div>
{/snippet}
