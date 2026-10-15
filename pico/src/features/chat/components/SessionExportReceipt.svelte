<script lang="ts">
  import { sessionExportState as state } from "@/features/chat/actions/session-export.state.svelte";
  import { Button } from "@/shared/ui/button";
</script>

{#if state.task}
  {@const task = state.task}
  <aside aria-label="Session export" class="shrink-0 border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 pt-2" style:padding-bottom="calc(var(--app-safe-bottom, env(safe-area-inset-bottom)) + 0.5rem)">
    <div class="column flex items-center gap-3">
      <div class="min-w-0 flex-1" role="status">
        <p class="type-meta text-[color:var(--color-fg-muted)]">{task.status === "preparing" ? "preparing export" : task.status === "ready" ? "export ready" : "export failed"}</p>
        <p class="type-meta truncate text-[color:var(--color-fg-faint)]">{task.title}</p>
        {#if task.status === "failed"}<p class="type-meta break-words text-[color:var(--color-danger)]">{task.error}</p>{/if}
        {#if state.deliveryError}<p class="type-meta break-words text-[color:var(--color-danger)]">{state.deliveryError}</p>{/if}
      </div>
      {#if task.status === "ready"}
        <Button type="button" variant="outline" size="sm" class="touch-target shrink-0" disabled={state.sharing} onclick={state.deliver}>share / download</Button>
      {:else if task.status === "failed"}
        <Button type="button" variant="outline" size="sm" class="touch-target shrink-0" onclick={() => state.start(task.sessionId, task.title)}>retry</Button>
      {/if}
      {#if task.status !== "preparing"}
        <button type="button" disabled={state.sharing} class="touch-target type-meta shrink-0 text-[color:var(--color-fg-muted)] disabled:opacity-60" onclick={state.dismiss}>dismiss</button>
      {/if}
    </div>
  </aside>
{/if}
