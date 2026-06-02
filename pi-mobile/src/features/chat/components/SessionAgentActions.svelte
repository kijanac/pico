<script lang="ts">
  import { MoreHorizontal } from "@lucide/svelte";
  import { createAgentActionsState } from "@/features/chat/actions/agent-actions.state.svelte";
  import { exportSessionHtml } from "@/features/chat/api";
  import AgentActionSheet from "@/features/chat/actions/AgentActionSheet.svelte";
  import AuthView from "@/features/chat/actions/AuthView.svelte";
  import CompactView from "@/features/chat/actions/CompactView.svelte";
  import MenuView from "@/features/chat/actions/MenuView.svelte";
  import SessionInfoView from "@/features/chat/actions/SessionInfoView.svelte";
  import SessionSettingsView from "@/features/chat/actions/SessionSettingsView.svelte";
  import TreeView from "@/features/chat/actions/TreeView.svelte";

  let { sessionId }: { sessionId: string } = $props();

  const actions = createAgentActionsState();

  async function exportToHtml(): Promise<void> {
    actions.setError(null);
    try {
      await exportSessionHtml(sessionId);
      actions.done();
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : String(error));
    }
  }
</script>

<button
  type="button"
  onclick={() => actions.setOpen(true)}
  class="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
  aria-label="Agent actions"
  title="Agent actions"
>
  <MoreHorizontal class="size-4" />
</button>

{#if actions.open}
  <AgentActionSheet
    bind:open={() => actions.open, (open) => actions.setOpen(open)}
    view={actions.view}
    error={actions.error}
    onBack={actions.back}
  >
    {#if actions.view === "menu"}
      <MenuView
        onModels={() => actions.setView("models")}
        onAuth={() => actions.setView("auth")}
        onCompact={() => actions.setView("compact")}
        onTree={() => actions.setView("tree")}
        onSettings={() => actions.setView("settings")}
        onInfo={() => actions.setView("info")}
        onExport={exportToHtml}
      />
    {:else if actions.view === "models"}
      <SessionSettingsView {sessionId} onError={actions.setError} filterKeys={["model"]} />
    {:else if actions.view === "compact"}
      <CompactView {sessionId} onDone={actions.done} onError={actions.setError} />
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
