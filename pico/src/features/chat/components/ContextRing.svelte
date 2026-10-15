<script lang="ts">
  import { Button } from "@/shared/ui/button";
  import { contextMeter } from "./context-meter";

  let { percent, onCompact }: { percent: number | null | undefined; onCompact: () => void } = $props();
  const meter = $derived(contextMeter(percent));
  const label = $derived(meter.kind === "known" ? `${meter.percent}% context used · compact context` : "context usage unavailable · compact context");
</script>

<Button type="button" variant="ghost" size="icon" class="size-11 shrink-0" aria-label={label} title={label} onclick={onCompact}>
  <svg viewBox="0 0 24 24" class="size-5" aria-hidden="true" data-context-fill={meter.kind === "known" ? meter.fill : undefined}>
    <circle cx="12" cy="12" r="8" fill="none" stroke="var(--color-border-strong)" stroke-width="2.5" stroke-dasharray={meter.kind === "unknown" ? "2 3" : undefined} />
    {#if meter.kind === "known" && meter.fill > 0}
      <circle cx="12" cy="12" r="8" fill="none" stroke="var(--color-accent)" stroke-width="2.5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset={100 - meter.fill} transform="rotate(-90 12 12)" />
    {/if}
    {#if meter.kind === "unknown"}<circle cx="12" cy="12" r="1" fill="var(--color-fg-muted)" />{/if}
  </svg>
</Button>
