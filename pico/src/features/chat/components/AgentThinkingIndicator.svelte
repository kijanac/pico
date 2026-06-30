<script lang="ts">
  let { label = "thinking" }: { label?: string } = $props();
</script>

<div class="type-message font-readable px-3 py-1.5 text-[color:var(--color-fg-muted)]" role="status" aria-live="polite" aria-label={label}>
  <span class="agent-working-glyph inline-flex text-[color:var(--color-accent)]" aria-hidden="true">
    <span class="agent-working-glyph__spark agent-working-glyph__spark--halo">✦</span>
    <span class="agent-working-glyph__spark agent-working-glyph__spark--trail">✦</span>
    <span class="agent-working-glyph__spark agent-working-glyph__spark--core">✦</span>
  </span>
</div>
