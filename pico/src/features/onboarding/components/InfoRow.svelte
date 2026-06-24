<script lang="ts">
  let { label, value }: { label: string; value: string } = $props();
</script>

<div class="type-meta rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2">
  <span class="label mr-2">{label}</span>
  <span class="text-[color:var(--color-fg-muted)]">{value}</span>
</div>
