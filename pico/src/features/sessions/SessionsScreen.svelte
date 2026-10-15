<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { currentPath, navigateTo, resolveRoute, routePaths } from "@/app/routes";
  import { createLatest } from "@/shared/lib/latest";
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
  let renameTarget = $state<SessionMeta | null>(null);
  let renameOpen = $state(false);
  let deleteTarget = $state<SessionMeta | null>(null);
  let openSwipeSessionId = $state<string | null>(null);
  const recentFolders = $derived([...new Set(sessionListState.sessions.map((session) => session.cwd))]);

  const creationFlow = createLatest();
  const renameFlow = createLatest();
  let createError = $state<string | null>(null);
  let renameError = $state<string | null>(null);
  let deleteError = $state<string | null>(null);

  onMount(() => {
    void sessionListState.refresh();
    const leave = () => {
      if (resolveRoute(currentPath()).id === "sessions") return;
      creationFlow.begin();
      renameFlow.begin();
      newSessionOpen = false;
      renameOpen = false;
      deleteTarget = null;
    };
    window.addEventListener("popstate", leave);
    return () => window.removeEventListener("popstate", leave);
  });

  onDestroy(() => {
    creationFlow.begin();
    renameFlow.begin();
  });

  $effect(() => { if (!newSessionOpen) creationFlow.begin(); });
  $effect(() => { if (!renameOpen) renameFlow.begin(); });

  async function createSession(input: { cwd: string; title?: string }): Promise<void> {
    const owner = creationFlow.begin();
    createError = null;
    try {
      const session = await sessionListState.create(input);
      if (!creationFlow.isCurrent(owner) || !newSessionOpen || resolveRoute(currentPath()).id !== "sessions") return;
      sessionListState.dismissCreatedSession();
      newSessionOpen = false;
      openSession(session);
    } catch (caught) {
      if (creationFlow.isCurrent(owner) && newSessionOpen) createError = hostIssueSummary(caught);
    }
  }

  async function renameSession(title: string): Promise<void> {
    if (!renameTarget) return;
    const id = renameTarget.id;
    const owner = renameFlow.begin();
    renameError = null;
    try {
      await sessionListState.rename(id, title);
      if (renameFlow.isCurrent(owner) && renameTarget?.id === id) renameOpen = false;
    } catch (caught) {
      if (renameFlow.isCurrent(owner) && renameTarget?.id === id) renameError = hostIssueSummary(caught);
    }
  }

  async function toggleArchive(session: SessionMeta): Promise<void> {
    try {
      await sessionListState.setArchived(session.id, !session.archived);
    } catch {}
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    deleteError = null;
    try {
      await sessionListState.delete(id);
      if (deleteTarget?.id === id) deleteTarget = null;
    } catch (caught) {
      if (deleteTarget?.id === id) deleteError = hostIssueSummary(caught);
    }
  }

  function requestRename(session: SessionMeta): void {
    openSwipeSessionId = null;
    renameFlow.begin();
    renameTarget = session;
    renameError = null;
    renameOpen = true;
  }

  function requestDelete(session: SessionMeta): void {
    openSwipeSessionId = null;
    deleteTarget = session;
    deleteError = null;
  }

  function openSession(session: SessionMeta): void {
    if (sessionListState.createdSession?.id === session.id) sessionListState.dismissCreatedSession();
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
  loaded={sessionListState.loaded}
  createdSession={sessionListState.createdSession}
  mutatingSessionId={sessionListState.mutatingSessionId}
  onDismissCreated={sessionListState.dismissCreatedSession}
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
    saving={sessionListState.mutatingSessionId !== null}
    error={renameError}
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
    {#if deleteError}<p class="type-copy text-[color:var(--color-danger)]" role="alert">{deleteError}</p>{/if}
    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={() => (deleteTarget = null)}>cancel</Button>
      <Button type="button" variant="destructive" disabled={!deleteTarget || sessionListState.mutatingSessionId !== null} onclick={confirmDelete}>
        delete
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
