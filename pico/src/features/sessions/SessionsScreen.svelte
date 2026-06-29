<script lang="ts">
  import { onMount } from "svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import { sessionListState, type HostSessionMeta } from "@/features/sessions/model/session-list.state.svelte";
  import { hostRegistryState } from "@/features/hosts/host-registry.state.svelte";
  import NewSessionSheet from "@/features/sessions/components/NewSessionSheet.svelte";
  import RenameSheet from "@/features/sessions/components/RenameSheet.svelte";
  import SessionsView from "@/features/sessions/components/SessionsView.svelte";
  import { haptics } from "@/shared/mobile/haptics";
  import { markSessionOpen } from "@/shared/lib/session-open-timing";
  import { Button } from "@/shared/ui/button";
  import * as Dialog from "@/shared/ui/dialog";

  let newSessionOpen = $state(false);
  let renameTarget = $state<HostSessionMeta | null>(null);
  let deleteTarget = $state<HostSessionMeta | null>(null);
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

  async function createSession(input: { hostId: string; cwd: string; title: string }): Promise<void> {
    const item = await sessionListState.create(input);
    newSessionOpen = false;
    navigateTo(routePaths.session(item.hostId, item.session.id));
  }

  async function renameSession(title: string): Promise<void> {
    if (!renameTarget) return;
    await sessionListState.rename(renameTarget.hostId, renameTarget.session.id, title);
    renameTarget = null;
    haptics.success();
  }

  async function toggleArchive(item: HostSessionMeta): Promise<void> {
    await sessionListState.setArchived(item.hostId, item.session.id, !item.session.archived);
    haptics.success();
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    await sessionListState.delete(deleteTarget.hostId, deleteTarget.session.id);
    deleteTarget = null;
    haptics.heavy();
  }

  function requestRename(item: HostSessionMeta): void {
    openSwipeSessionId = null;
    renameTarget = item;
  }

  function requestDelete(item: HostSessionMeta): void {
    openSwipeSessionId = null;
    deleteTarget = item;
  }

  function openSession(item: HostSessionMeta): void {
    markSessionOpen(`${item.hostId}:${item.session.id}`, "tap");
    navigateTo(routePaths.session(item.hostId, item.session.id));
  }
</script>

<SessionsView
  sessions={sessionListState.sessions}
  refreshing={sessionListState.refreshing}
  hostIssues={sessionListState.hostIssues}
  archivedView={sessionListState.archivedView}
  visibleCount={sessionListState.visibleCount}
  creating={sessionListState.creating}
  hostConfigured={!settingsState.loaded || settingsState.hostUrlConfigured}
  onSetupHost={() => navigateTo(routePaths.welcome)}
  bind:openSwipeSessionId
  onRefresh={() => sessionListState.refresh()}
  onRefreshHost={(hostId) => sessionListState.refreshHost(hostId)}
  onToggleArchived={() => sessionListState.switchArchivedView(!sessionListState.archivedView)}
  onSettings={() => navigateTo(routePaths.settings)}
  onNewSession={() => (newSessionOpen = true)}
  onOpenSession={openSession}
  onRename={requestRename}
  onToggleArchive={toggleArchive}
  onDelete={requestDelete}
/>

<NewSessionSheet bind:open={newSessionOpen} hosts={hostRegistryState.hosts} defaultHostId={hostRegistryState.defaultHostId} creating={sessionListState.creating} onCreate={createSession} />

{#if renameTarget}
  <RenameSheet
    bind:open={() => !!renameTarget, (open) => {
      if (!open) renameTarget = null;
    }}
    initialTitle={renameTarget.session.title}
    saving={sessionListState.mutatingSessionKey === `${renameTarget.hostId}:${renameTarget.session.id}`}
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
      <Button type="button" variant="destructive" disabled={!deleteTarget || sessionListState.mutatingSessionKey === `${deleteTarget.hostId}:${deleteTarget.session.id}`} onclick={confirmDelete}>
        delete
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
