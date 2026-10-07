<script lang="ts">
  import { onMount } from "svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import type { SessionMeta } from "@pico/protocol";
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import NewSessionSheet from "@/features/sessions/components/NewSessionSheet.svelte";
  import RenameSheet from "@/features/sessions/components/RenameSheet.svelte";
  import SessionsView from "@/features/sessions/components/SessionsView.svelte";
  import { hostIssueSummary } from "@/shared/lib/host-issues";
  import { markSessionOpen } from "@/shared/lib/session-open-timing";
  import { Button } from "@/shared/ui/button";
  import * as Dialog from "@/shared/ui/dialog";

  let newSessionOpen = $state(false);
  // The target outlives the sheet's open state, so the sheet can slide away.
  let renameTarget = $state<SessionMeta | null>(null);
  let renameOpen = $state(false);
  let deleteTarget = $state<SessionMeta | null>(null);
  let openSwipeSessionId = $state<string | null>(null);
  const recentFolders = $derived([...new Set(sessionListState.sessions.map((session) => session.cwd))]);

  onMount(() => {
    sessionListState.refresh().catch(() => {});
  });

  // Shown in the sheet, which keeps the folder and title for a retry.
  let createError = $state<string | null>(null);

  async function createSession(input: { cwd: string; title?: string }): Promise<void> {
    createError = null;
    try {
      const session = await sessionListState.create(input);
      newSessionOpen = false;
      navigateTo(routePaths.session(session.id));
    } catch (caught) {
      createError = hostIssueSummary(caught);
    }
  }

  async function renameSession(title: string): Promise<void> {
    if (!renameTarget) return;
    await sessionListState.rename(renameTarget.id, title);
    renameOpen = false;
  }

  async function toggleArchive(session: SessionMeta): Promise<void> {
    await sessionListState.setArchived(session.id, !session.archived);
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    await sessionListState.delete(deleteTarget.id);
    deleteTarget = null;
  }

  function requestRename(session: SessionMeta): void {
    openSwipeSessionId = null;
    renameTarget = session;
    renameOpen = true;
  }

  function requestDelete(session: SessionMeta): void {
    openSwipeSessionId = null;
    deleteTarget = session;
  }

  function openSession(session: SessionMeta): void {
    markSessionOpen(session.id, "tap");
    navigateTo(routePaths.session(session.id));
  }
</script>

<SessionsView
  sessions={sessionListState.sessions}
  refreshing={sessionListState.refreshing}
  error={sessionListState.error}
  archivedView={sessionListState.archivedView}
  creating={sessionListState.creating}
  bind:openSwipeSessionId
  onRefresh={() => sessionListState.refresh()}
  onToggleArchived={() => sessionListState.switchArchivedView(!sessionListState.archivedView)}
  onSettings={() => navigateTo(routePaths.settings)}
  onNewSession={() => {
    createError = null;
    newSessionOpen = true;
  }}
  onOpenSession={openSession}
  onRename={requestRename}
  onToggleArchive={toggleArchive}
  onDelete={requestDelete}
/>

<NewSessionSheet bind:open={newSessionOpen} creating={sessionListState.creating} error={createError} folders={recentFolders} onCreate={createSession} />

{#if renameTarget}
  <RenameSheet
    bind:open={renameOpen}
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
        this permanently deletes the session.
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
