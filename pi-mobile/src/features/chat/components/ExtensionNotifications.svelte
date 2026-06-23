<script lang="ts">
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";

  const notice = $derived(activeSessionState.extensionNotification);
  // Mirror pi's TUI: no label for info (just the dimmed message); "Warning:"/"Error:"
  // prefix + escalating color for the rest.
  const prefix = $derived(
    notice?.level === "error" ? "Error: " : notice?.level === "warning" ? "Warning: " : "",
  );
</script>

<!--
  Transient status line for ctx.ui.notify() — one line, latest message only,
  auto-clears (see active-session.state). Sits inline above the input so it never
  overlaps the conversation; tap to dismiss.
-->
{#if notice}
  <button
    type="button"
    onpointerdown={(event) => event.preventDefault()}
    onclick={() => activeSessionState.dismissExtensionNotification()}
    class="flex w-full items-center border-t border-[color:var(--color-border)] px-3 py-2 text-left active:bg-[color:var(--color-surface)]"
  >
    <span
      class="type-meta min-w-0 flex-1 truncate {notice.level === 'error'
        ? 'text-[color:var(--color-danger)]'
        : notice.level === 'warning'
          ? 'text-[color:var(--color-fg)]'
          : 'text-[color:var(--color-fg-muted)]'}">{prefix}{notice.message}</span>
  </button>
{/if}
