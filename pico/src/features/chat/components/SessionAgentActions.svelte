<script lang="ts">
  import { ListTree } from "@lucide/svelte";
  import { sessionExportState } from "@/features/chat/actions/session-export.state.svelte";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import AgentActionSheet from "@/features/chat/actions/AgentActionSheet.svelte";
  import SessionInfoView from "@/features/chat/actions/SessionInfoView.svelte";
  import SessionSettingsView from "@/features/chat/actions/SessionSettingsView.svelte";
  import TreeView from "@/features/chat/actions/TreeView.svelte";
  import { Button } from "@/shared/ui/button";
  import type { AgentActionView } from "@/features/chat/actions/types";

  let { sessionId }: { sessionId: string } = $props();

  let open = $state(false);
  let view = $state<AgentActionView>("tree");
  let error = $state<string | null>(null);

  export function showView(next: AgentActionView): void {
    view = next;
    error = null;
    open = true;
  }

  function exportToHtml(): void {
    if (sessionExportState.busy) return;
    error = null;
    open = false;
    const title = activeSessionState.id === sessionId ? activeSessionState.session?.title ?? "session" : "session";
    sessionExportState.start(sessionId, title);
  }
</script>

<Button
  type="button"
  variant="ghost"
  size="icon"
  onclick={() => showView("tree")}
  class="size-11 shrink-0 rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
  aria-label="Conversation tree"
  title="Conversation tree"
>
  <ListTree size={20} class="size-5" />
</Button>

<AgentActionSheet bind:open {view} {error}>
  {#if view === "settings"}
    <SessionSettingsView {sessionId} onError={(message) => (error = message)} excludeKeys={["model", "thinkingLevel"]} />
  {:else if view === "tree"}
    <TreeView {sessionId} onDone={() => (open = false)} onError={(message) => (error = message)} />
  {:else if view === "info"}
    <SessionInfoView {sessionId} onExport={exportToHtml} exporting={sessionExportState.busy} />
  {/if}
</AgentActionSheet>
