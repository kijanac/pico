<script lang="ts">
  import { Loader2 } from "@lucide/svelte";
  import { retryState } from "@/features/chat/model/retry-state.svelte";
</script>

{#if retryState.active}
  <div
    class="text-meta hairline-b flex items-center gap-2 px-3 py-1.5 text-[color:var(--color-warning,#d97706)]"
    role="status"
    aria-live="polite"
  >
    <Loader2 class="size-3 shrink-0 animate-spin" />
    <span class="font-medium tabular-nums">retrying {retryState.active.attempt} of {retryState.active.maxAttempts}</span>
    <span class="min-w-0 flex-1 truncate text-[color:var(--color-fg-muted)]">— {retryState.active.errorMessage}</span>
  </div>
{/if}
