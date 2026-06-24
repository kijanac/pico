<script lang="ts">
  let { label, value }: { label: string; value: string } = $props();
</script>

<div class="flex items-center justify-between gap-3 py-1">
  <span class="text-[color:var(--color-fg-faint)]">{label}</span>
  <span class="font-mono tabular-nums text-[color:var(--color-fg)]">{value}</span>
</div>
