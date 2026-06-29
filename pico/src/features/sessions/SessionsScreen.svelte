<script lang="ts">
  import { onMount } from "svelte";
  import type { SessionMeta } from "@pico/protocol";
  import { navigateTo, routePaths } from "@/app/routes";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import NewSessionSheet from "@/features/sessions/components/NewSessionSheet.svelte";
  import RenameSheet from "@/features/sessions/components/RenameSheet.svelte";
  import SessionsView from "@/features/sessions/components/SessionsView.svelte";
  import { haptics } from "@/shared/mobile/haptics";
  import { markSessionOpen } from "@/shared/lib/session-open-timing";
  import { Button } from "@/shared/ui/button";
  import * as Dialog from "@/shared/ui/dialog";

  let newSessionOpen = $state(false);
  let renameTarget = $state<SessionMeta | null>(null);
  let deleteTarget = $state<SessionMeta | null>(null);
  let openSwipeSessionId = $state<string | null>(null);

  onMount(() => {
    void (async () => {
      if (!settingsState.loaded) await settingsState.load();
      if (!settingsState.hostUrlConfigured) {
        if (!settingsState.welcomeSkipped) navigateTo(routePaths.welcome, "replace");
        return;
      }
      await sessionListState.refresh().catch(() => {});
    })();
  });

  async function createSession(input: { cwd: string; title: string }): Promise<void> {
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

  function requestRename(session: SessionMeta): void {
    openSwipeSessionId = null;
    renameTarget = session;
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
  visibleCount={sessionListState.visibleCount}
  creating={sessionListState.creating}
  hostConfigured={!settingsState.loaded || settingsState.hostUrlConfigured}
  onSetupHost={() => navigateTo(routePaths.welcome)}
  bind:openSwipeSessionId
  onRefresh={() => sessionListState.refresh()}
  onToggleArchived={() => sessionListState.switchArchivedView(!sessionListState.archivedView)}
  onSettings={() => navigateTo(routePaths.settings)}
  onNewSession={() => (newSessionOpen = true)}
  onOpenSession={openSession}
  onRename={requestRename}
  onToggleArchive={toggleArchive}
  onDelete={requestDelete}
/>

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
