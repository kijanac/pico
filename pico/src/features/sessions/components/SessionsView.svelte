<script lang="ts">
  import { Archive, ArchiveRestore, Pencil, Plus, Settings as SettingsIcon, Trash2 } from "@lucide/svelte";
  import HostIssuePanel from "@/shared/components/HostIssuePanel.svelte";
  import type { HostSessionIssue, HostSessionMeta } from "@/features/sessions/model/session-list.state.svelte";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import PullToRefresh from "@/shared/components/PullToRefresh.svelte";
  import SwipeActionRow from "@/shared/components/SwipeActionRow.svelte";
  import { formatCost, relativeTime } from "@/shared/lib/format";
  import { cwdDisplayName } from "@/shared/lib/path-display";
  import { Button } from "@/shared/ui/button";

  let {
    sessions,
    refreshing,
    hostIssues = [],
    archivedView,
    visibleCount,
    creating = false,
    interactive = true,
    hostConfigured = true,
    openSwipeSessionId = $bindable(null),
    onRefresh = async () => {},
    onRefreshHost = async () => {},
    onToggleArchived = () => {},
    onSettings = () => {},
    onSetupHost = () => {},
    onNewSession = () => {},
    onOpenSession = () => {},
    onRename = () => {},
    onToggleArchive = () => {},
    onDelete = () => {},
  }: {
    sessions: readonly HostSessionMeta[];
    refreshing: boolean;
    hostIssues?: readonly HostSessionIssue[];
    archivedView: boolean;
    visibleCount: number;
    creating?: boolean;
    interactive?: boolean;
    hostConfigured?: boolean;
    openSwipeSessionId?: string | null;
    onRefresh?: () => Promise<void>;
    onRefreshHost?: (hostId: string) => Promise<void>;
    onToggleArchived?: () => void | Promise<void>;
    onSettings?: () => void;
    onSetupHost?: () => void;
    onNewSession?: () => void;
    onOpenSession?: (session: HostSessionMeta) => void;
    onRename?: (session: HostSessionMeta) => void;
    onToggleArchive?: (session: HostSessionMeta) => void | Promise<void>;
    onDelete?: (session: HostSessionMeta) => void;
  } = $props();

  type DotTone = "muted" | "accent" | "warn" | "danger";

  const SESSION_ACTION_WIDTH = 58;
  const activeHostIssues = $derived(hostConfigured ? hostIssues : []);
  const firstHostIssue = $derived(activeHostIssues[0] ?? null);

  function sessionStatusTone(status: HostSessionMeta["session"]["status"]): DotTone {
    if (status === "thinking" || status === "tool") return "accent";
    if (status === "waiting") return "warn";
    if (status === "error") return "danger";
    return "muted";
  }

  function sessionStatusActive(status: HostSessionMeta["session"]["status"]): boolean {
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

  {#if activeHostIssues.length > 0 && sessions.length > 0}
    <div class="mx-3 mt-4 space-y-2">
      {#each activeHostIssues as item (item.hostId)}
        <HostIssuePanel issue={item.issue} compact>
          {#snippet action()}
            <button type="button" class="type-meta underline text-[color:var(--color-fg-muted)] active:opacity-70" onclick={() => void onRefreshHost(item.hostId)}>
              retry {item.hostName}
            </button>
          {/snippet}
        </HostIssuePanel>
      {/each}
    </div>
  {/if}

  <PullToRefresh onRefresh={onRefresh} class="mt-4 min-h-0 flex-1">
    {#if refreshing && sessions.length === 0}
      <section class="type-copy flex min-h-full items-center justify-center text-[color:var(--color-fg-muted)]">loading sessions…</section>
    {:else if firstHostIssue && sessions.length === 0}
      <section class="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <HostIssuePanel issue={firstHostIssue.issue} class="max-w-sm" />
        <div class="flex gap-2">
          <Button type="button" variant="outline" size="sm" onclick={() => void onRefresh()}>retry</Button>
          <Button type="button" size="sm" onclick={onSettings}>host settings</Button>
        </div>
      </section>
    {:else if sessions.length === 0 && !hostConfigured && !archivedView}
      <section class="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div>
          <p class="type-title font-medium">no Pico host connected</p>
          <p class="type-copy mt-2 max-w-[34ch] text-[color:var(--color-fg-muted)]">
            pico drives pi on your machine. connect a Pico host to start your first session.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onclick={onSetupHost}>set up Pico host</Button>
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
        {#each sessions as item (`${item.hostId}:${item.session.id}`)}
          {#if interactive}
            <SwipeActionRow
              open={openSwipeSessionId === `${item.hostId}:${item.session.id}`}
              actionWidth={SESSION_ACTION_WIDTH}
              actionCount={3}
              onOpen={() => (openSwipeSessionId = `${item.hostId}:${item.session.id}`)}
              onClose={() => {
                if (openSwipeSessionId === `${item.hostId}:${item.session.id}`) openSwipeSessionId = null;
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

  <div class="p-2" style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem)">
    {#if hostConfigured}
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
      <Button type="button" class="h-10 w-full" onclick={onSetupHost}>
        set up Pico host
      </Button>
    {/if}
  </div>
</main>

{#snippet RowActions(item: HostSessionMeta)}
  <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-surface)] text-[color:var(--color-fg-muted)]" onclick={() => onRename(item)} aria-label="Rename session"><Pencil class="size-4" /></button>
  <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-surface)] text-[color:var(--color-fg-muted)]" onclick={() => void onToggleArchive(item)} aria-label={item.session.archived ? "Unarchive session" : "Archive session"}>{#if item.session.archived}<ArchiveRestore class="size-4" />{:else}<Archive class="size-4" />{/if}</button>
  <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-danger)] text-[color:var(--color-bg)]" onclick={() => onDelete(item)} aria-label="Delete session"><Trash2 class="size-4" /></button>
{/snippet}

{#snippet RowContent(item: HostSessionMeta)}
  <div class="flex items-center gap-2 bg-[color:var(--color-bg)] px-3 py-3 active:bg-[color:var(--color-surface)]">
    <button type="button" class="min-w-0 flex-1 text-left" onclick={() => onOpenSession(item)}>
      <div class="mb-1 flex items-center gap-2">
        <StatusDot tone={sessionStatusTone(item.session.status)} active={sessionStatusActive(item.session.status)} label={item.session.status} />
        <span class="type-title min-w-0 flex-1 truncate">{item.session.title}</span>
        <span class="type-label uppercase tracking-[0.08em] tabular-nums text-[color:var(--color-fg-faint)]">{relativeTime(item.session.updatedAt)}</span>
      </div>
      <div class="type-meta flex items-center gap-3 text-[color:var(--color-fg-muted)]">
        <span class="min-w-0 flex-1 truncate">{cwdDisplayName(item.session.cwd)}</span>
        <span class="shrink-0 truncate text-[color:var(--color-fg-faint)]">{item.hostName}</span>
        <span class="shrink-0 tabular-nums">{formatCost(item.session.costUsd)}</span>
      </div>
    </button>
  </div>
{/snippet}
