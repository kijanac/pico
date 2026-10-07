<script lang="ts">
  import { Loader2 } from "@lucide/svelte";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
</script>

{#if chatLogState.live.retry}
  <div
    class="type-meta hairline-b flex items-center gap-2 px-3 py-1.5 text-[color:var(--color-warning,#d97706)]"
    role="status"
    aria-live="polite"
  >
    <Loader2 class="size-3 shrink-0 animate-spin" />
    <span class="font-medium tabular-nums">retrying {chatLogState.live.retry.attempt} of {chatLogState.live.retry.maxAttempts}</span>
    <span class="min-w-0 flex-1 truncate text-[color:var(--color-fg-muted)]">— {chatLogState.live.retry.errorMessage}</span>
  </div>
{/if}
