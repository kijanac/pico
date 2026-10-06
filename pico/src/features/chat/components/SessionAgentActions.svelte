<script lang="ts">
  import { tick } from "svelte";
  import { MoreHorizontal } from "@lucide/svelte";
  import { createAgentActionsState } from "@/features/chat/actions/agent-actions.state.svelte";
  import { exportSessionHtml, moveSessionToBackground } from "@/features/chat/api";
  import { hostIssueSummary } from "@/shared/lib/host-issues";
  import AgentActionSheet from "@/features/chat/actions/AgentActionSheet.svelte";
  import AuthView from "@/features/chat/actions/AuthView.svelte";
  import MenuView from "@/features/chat/actions/MenuView.svelte";
  import SessionInfoView from "@/features/chat/actions/SessionInfoView.svelte";
  import SessionSettingsView from "@/features/chat/actions/SessionSettingsView.svelte";
  import TreeView from "@/features/chat/actions/TreeView.svelte";
  import { Button } from "@/shared/ui/button";
  import * as Dialog from "@/shared/ui/dialog";
  import { runOnHost } from "@/shared/lib/rpc-client";
  import { haptics } from "@/shared/mobile/haptics";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";

  let { hostId, sessionId }: { hostId: string; sessionId: string } = $props();

  const actions = createAgentActionsState();
  let backgroundConfirm = $state(false);
  let backgrounding = $state(false);
  let backgroundError = $state<string | null>(null);

  async function openBackgroundConfirm(): Promise<void> {
    actions.close();
    await tick();
    backgroundError = null;
    backgroundConfirm = true;
  }

  async function moveToBackground(): Promise<void> {
    if (backgrounding) return;
    backgrounding = true;
    backgroundError = null;
    try {
      await runOnHost(hostId, moveSessionToBackground(sessionId));
      activeSessionState.setExecution("transferring");
      backgroundConfirm = false;
      haptics.success();
    } catch (error) {
      backgroundError = hostIssueSummary(error);
      haptics.error();
    } finally {
      backgrounding = false;
    }
  }

  async function exportToHtml(): Promise<void> {
    actions.setError(null);
    actions.close();
    await tick();

    try {
      if (await exportSessionHtml(hostId, sessionId)) actions.done();
    } catch (error) {
      actions.setOpen(true);
      actions.setError(hostIssueSummary(error));
    }
  }
</script>

<Button
  type="button"
  variant="ghost"
  size="icon"
  onclick={() => actions.setOpen(true)}
  class="rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
  aria-label="Agent actions"
  title="Agent actions"
>
  <MoreHorizontal class="size-4" />
</Button>

{#if actions.open}
  <AgentActionSheet
    bind:open={() => actions.open, (open) => actions.setOpen(open)}
    view={actions.view}
    error={actions.error}
    onBack={actions.back}
  >
    {#if actions.view === "menu"}
      <MenuView
        onAuth={() => actions.setView("auth")}
        onTree={() => actions.setView("tree")}
        onSettings={() => actions.setView("settings")}
        onInfo={() => actions.setView("info")}
        onExport={exportToHtml}
        onBackground={openBackgroundConfirm}
        showTree={activeSessionState.supports("tree")}
        showSettings={activeSessionState.supports("settings")}
        showExport={activeSessionState.supports("export")}
        showBackground={activeSessionState.execution === "terminal" && activeSessionState.canBackground}
      />
    {:else if actions.view === "settings"}
      <SessionSettingsView {hostId} {sessionId} onError={actions.setError} excludeKeys={["model"]} />
    {:else if actions.view === "tree"}
      <TreeView {hostId} {sessionId} onDone={actions.done} onError={actions.setError} />
    {:else if actions.view === "info"}
      <SessionInfoView {hostId} {sessionId} />
    {:else if actions.view === "auth"}
      <AuthView {hostId} onError={actions.setError} />
    {/if}
  </AgentActionSheet>
{/if}

<Dialog.Root bind:open={backgroundConfirm}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>move session to background?</Dialog.Title>
      <Dialog.Description>
        Pi will finish its current turn, leave Terminal, and keep running through Pico. Return it to Terminal later with <code>pico resume</code>.
      </Dialog.Description>
    </Dialog.Header>
    {#if backgroundError}
      <p class="type-copy text-pretty text-[color:var(--color-danger)]">{backgroundError}</p>
    {/if}
    <Dialog.Footer>
      <Button type="button" variant="outline" disabled={backgrounding} onclick={() => (backgroundConfirm = false)}>cancel</Button>
      <Button type="button" disabled={backgrounding} onclick={() => void moveToBackground()}>
        {backgrounding ? "moving…" : "move to background"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
