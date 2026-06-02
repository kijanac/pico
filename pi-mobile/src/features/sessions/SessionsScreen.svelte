<script lang="ts">
  import { onMount } from "svelte";
  import { Archive, ArchiveRestore, Pencil, Plus, Settings as SettingsIcon, Trash2 } from "@lucide/svelte";
  import type { SessionMeta } from "@pi-mobile/protocol";
  import { navigateTo, routePaths } from "@/app/routes";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import NewSessionSheet from "@/features/sessions/components/NewSessionSheet.svelte";
  import RenameSheet from "@/features/sessions/components/RenameSheet.svelte";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import PullToRefresh from "@/shared/components/PullToRefresh.svelte";
  import SwipeActionRow from "@/shared/components/SwipeActionRow.svelte";
  import { haptics } from "@/shared/mobile/haptics";
  import { formatCost, relativeTime } from "@/shared/lib/format";
  import { cwdDisplayName } from "@/shared/lib/path-display";
  import { Button } from "@/shared/ui/button";
  import * as Dialog from "@/shared/ui/dialog";

  let newSessionOpen = $state(false);
  let renameTarget = $state<SessionMeta | null>(null);
  let deleteTarget = $state<SessionMeta | null>(null);
  let openSwipeSessionId = $state<string | null>(null);

  const SESSION_ACTION_WIDTH = 58;

  onMount(() => {
    void (async () => {
      if (!settingsState.loaded) await settingsState.load();
      await sessionListState.refresh().catch(() => {});
    })();
  });

  async function createSession(input: { cwd: string; title: string; branch?: string }): Promise<void> {
    const session = await sessionListState.create(input);
    newSessionOpen = false;
    navigateTo(routePaths.session(session.id));
  }

  async function renameSession(title: string): Promise<void> {
    if (!renameTarget) return;
    await sessionListState.rename(renameTarget.id, title);
    renameTarget = null;
    haptics.success();
  }

  async function toggleArchive(session: SessionMeta): Promise<void> {
    await sessionListState.setArchived(session.id, !session.archived);
    haptics.success();
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    await sessionListState.delete(deleteTarget.id);
    deleteTarget = null;
    haptics.heavy();
  }

  function closeOpenSwipeRow(event: Event): void {
    if (!openSwipeSessionId) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-swipe-action-row]")) return;
    openSwipeSessionId = null;
  }

  function requestRename(session: SessionMeta): void {
    openSwipeSessionId = null;
    renameTarget = session;
  }

  function requestDelete(session: SessionMeta): void {
    openSwipeSessionId = null;
    deleteTarget = session;
  }
</script>

<main
  class="flex min-h-0 flex-1 flex-col pt-[calc(env(safe-area-inset-top)+16px)]"
  ontouchstart={closeOpenSwipeRow}
>
  <header class="flex items-center justify-between gap-3 px-3">
    <div class="flex items-baseline gap-2">
      <h1 class="text-[13px] font-medium">{sessionListState.archivedView ? "archived" : "sessions"}</h1>
      <span class="text-[10px] text-[color:var(--color-fg-faint)]">{sessionListState.visibleCount}</span>
    </div>
    <div class="flex items-center gap-1">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Toggle archived" onclick={() => sessionListState.switchArchivedView(!sessionListState.archivedView)}>
        {#if sessionListState.archivedView}
          <ArchiveRestore class="size-3.5" />
        {:else}
          <Archive class="size-3.5" />
        {/if}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Settings" onclick={() => navigateTo(routePaths.settings)}>
        <SettingsIcon class="size-3.5" />
      </Button>
    </div>
  </header>

  {#if sessionListState.error}
    <div
      class="mx-3 mt-4 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[12px] text-[color:var(--color-danger)]"
    >
      {sessionListState.error}
      <button type="button" class="ml-2 underline opacity-70" onclick={() => sessionListState.refresh()}>
        retry
      </button>
    </div>
  {/if}

  <PullToRefresh onRefresh={() => sessionListState.refresh()} class="mt-4 min-h-0 flex-1">
    {#if sessionListState.refreshing && sessionListState.sessions.length === 0}
      <section class="flex min-h-full items-center justify-center text-[12px] text-[color:var(--color-fg-faint)]">loading sessions…</section>
    {:else if sessionListState.sessions.length === 0}
      <section class="flex min-h-full items-center justify-center px-6 text-center">
        <p class="max-w-[32ch] text-[12px] text-[color:var(--color-fg-faint)]">
          {sessionListState.archivedView ? "no archived sessions." : "no sessions yet — tap new session below."}
        </p>
      </section>
    {:else}
      <section class="flex min-h-full flex-col">
        {#each sessionListState.sessions as session (session.id)}
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
              <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-surface)] text-[color:var(--color-fg-muted)]" onclick={() => requestRename(session)} aria-label="Rename session"><Pencil class="size-4" /></button>
              <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-surface)] text-[color:var(--color-fg-muted)]" onclick={() => toggleArchive(session)} aria-label={session.archived ? "Unarchive session" : "Archive session"}>{#if session.archived}<ArchiveRestore class="size-4" />{:else}<Archive class="size-4" />{/if}</button>
              <button type="button" class="flex w-[58px] items-center justify-center bg-[color:var(--color-danger)] text-[color:var(--color-bg)]" onclick={() => requestDelete(session)} aria-label="Delete session"><Trash2 class="size-4" /></button>
            {/snippet}

            <div class="flex items-center gap-2 bg-[color:var(--color-bg)] px-3 py-3 active:bg-[color:var(--color-surface)]">
              <button type="button" class="min-w-0 flex-1 text-left" onclick={() => navigateTo(routePaths.session(session.id))}>
                <div class="mb-1 flex items-center gap-2">
                  <StatusDot status={session.status} />
                  <span class="min-w-0 flex-1 truncate text-[13px] leading-tight">{session.title}</span>
                  <span class="text-[10px] tabular-nums text-[color:var(--color-fg-faint)]">{relativeTime(session.updatedAt)}</span>
                </div>
                <div class="flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
                  <span class="truncate">{cwdDisplayName(session.cwd)}</span>
                  {#if session.branch}<span class="shrink-0">{session.branch}</span>{/if}
                  <span class="ml-auto shrink-0 tabular-nums">{formatCost(session.costUsd)}</span>
                </div>
              </button>
            </div>
          </SwipeActionRow>
        {/each}
      </section>
    {/if}
  </PullToRefresh>

  <div class="p-2" style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem)">
    <Button
      type="button"
      class="h-10 w-full"
      disabled={sessionListState.creating}
      onclick={() => (newSessionOpen = true)}
    >
      <Plus class="size-3.5" />
      new session
    </Button>
  </div>
</main>

<NewSessionSheet bind:open={newSessionOpen} creating={sessionListState.creating} onCreate={createSession} />

{#if renameTarget}
  <RenameSheet
    bind:open={() => !!renameTarget, (open) => {
      if (!open) renameTarget = null;
    }}
    initialTitle={renameTarget.title}
    saving={sessionListState.mutatingSessionId === renameTarget.id}
    onSave={renameSession}
  />
{/if}

<Dialog.Root open={!!deleteTarget} onOpenChange={(open) => {
  if (!open) deleteTarget = null;
}}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>delete session?</Dialog.Title>
      <Dialog.Description>
        This permanently deletes {deleteTarget?.title ?? "this session"} from the bridge.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={() => (deleteTarget = null)}>cancel</Button>
      <Button type="button" variant="destructive" disabled={!deleteTarget || sessionListState.mutatingSessionId === deleteTarget.id} onclick={confirmDelete}>
        delete
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
