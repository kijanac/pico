<script lang="ts">
  let { eyebrow, title, children }: { eyebrow: string; title: string; children?: import("svelte").Snippet } = $props();
</script>

<section class="space-y-4 rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <div>
    <div class="label mb-1">{eyebrow}</div>
    <h2 class="text-[18px] font-semibold tracking-tight text-[color:var(--color-fg)]">{title}</h2>
  </div>
  {@render children?.()}
</section>
