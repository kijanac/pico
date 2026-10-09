<script lang="ts">
  import { GitBranch } from "@lucide/svelte";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
  import { relativeTime } from "@/shared/lib/format";

  // Another pi (a terminal, say) saved messages on another branch of this
  // session since this one last moved on. The tree shows them.
  let { onShowTree }: { onShowTree: () => void } = $props();

  const elsewhere = $derived(chatLogState.live.elsewhere);

  // "2 min ago" stays true while the notice shows.
  let now = $state(Date.now());
  $effect(() => {
    if (!elsewhere) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });
</script>

{#if elsewhere}
  <button
    type="button"
    class="column type-meta hairline-b flex items-center gap-2 px-3 py-1.5 pointer-coarse:py-3 text-left text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
    onclick={onShowTree}
  >
    <GitBranch class="size-3 shrink-0" />
    <span class="min-w-0 flex-1 truncate">{elsewhere.messages} new on another branch · {relativeTime(elsewhere.at, now)}</span>
    <span class="shrink-0 underline">tree</span>
  </button>
{/if}
