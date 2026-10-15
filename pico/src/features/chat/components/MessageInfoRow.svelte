<script lang="ts">
  let { label, value }: { label: string; value: string } = $props();
</script>

<div class="flex items-baseline justify-between gap-4">
  <dt class="shrink-0 text-[color:var(--color-fg-muted)]">{label}</dt>
  <dd class="min-w-0 text-right font-mono tabular-nums text-[color:var(--color-fg)] [overflow-wrap:anywhere]">{value}</dd>
</div>
