<script lang="ts">
  import { tick } from "svelte";
  import { MoreHorizontal } from "@lucide/svelte";
  import { createAgentActionsState } from "@/features/chat/actions/agent-actions.state.svelte";
  import { exportSessionHtml } from "@/features/chat/api";
  import { hostIssueSummary } from "@/shared/lib/host-issues";
  import AgentActionSheet from "@/features/chat/actions/AgentActionSheet.svelte";
  import AuthView from "@/features/chat/actions/AuthView.svelte";
  import MenuView from "@/features/chat/actions/MenuView.svelte";
  import SessionInfoView from "@/features/chat/actions/SessionInfoView.svelte";
  import SessionSettingsView from "@/features/chat/actions/SessionSettingsView.svelte";
  import TreeView from "@/features/chat/actions/TreeView.svelte";
  import { Button } from "@/shared/ui/button";

  let { sessionId }: { sessionId: string } = $props();

  const actions = createAgentActionsState();

  async function exportToHtml(): Promise<void> {
    actions.setError(null);
    actions.close();
    await tick();

    try {
      if (await exportSessionHtml(sessionId)) actions.done();
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
      />
    {:else if actions.view === "settings"}
      <SessionSettingsView {sessionId} onError={actions.setError} excludeKeys={["model"]} />
    {:else if actions.view === "tree"}
      <TreeView {sessionId} onDone={actions.done} onError={actions.setError} />
    {:else if actions.view === "info"}
      <SessionInfoView {sessionId} />
    {:else if actions.view === "auth"}
      <AuthView onError={actions.setError} />
    {/if}
  </AgentActionSheet>
{/if}
