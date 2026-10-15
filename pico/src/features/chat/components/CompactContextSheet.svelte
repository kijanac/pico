<script lang="ts">
  import CompactContextForm from "@/features/chat/components/CompactContextForm.svelte";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import * as Sheet from "@/shared/ui/sheet";
  import type { SessionStats } from "@pico/protocol";
  import { formatTokens } from "@/shared/lib/format";
  import { contextMeter } from "./context-meter";

  let { open = $bindable(false), sessionId, usage, busy, compacting, onError }: { open: boolean; sessionId: string; usage?: SessionStats["contextUsage"]; busy: boolean; compacting: boolean; onError: (message: string) => void } = $props();
  const meter = $derived(contextMeter(usage?.percent));

  function startCompaction(): void {
    open = false;
  }
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent>
    <SheetHeader title="compact context" />
    <p class="type-meta px-3 pt-3 text-[color:var(--color-fg-muted)]">
      {#if meter.kind === "known"}
        {meter.percent}% used{usage?.tokens !== null && usage?.tokens !== undefined ? ` · ${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} tokens` : ""}
      {:else}
        current usage unavailable{usage ? ` · ${formatTokens(usage.contextWindow)} token limit` : ""}
      {/if}
    </p>
    <CompactContextForm {sessionId} disabled={compacting} label={compacting ? "compacting…" : busy ? "stop & compact" : "compact now"} onStart={startCompaction} {onError} />
  </Sheet.BottomContent>
</Sheet.Root>
