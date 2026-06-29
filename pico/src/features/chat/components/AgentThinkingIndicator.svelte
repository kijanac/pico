<script lang="ts">
  let { label = "thinking" }: { label?: string } = $props();
</script>

<div class="type-message font-readable px-3 py-1.5 text-[color:var(--color-fg-muted)]" role="status" aria-live="polite">
  <span class="inline-flex items-center gap-2">
    <span class="agent-working-glyph text-[color:var(--color-accent)]" aria-hidden="true">
      <span class="agent-working-glyph__spark agent-working-glyph__spark--halo">✦</span>
      <span class="agent-working-glyph__spark agent-working-glyph__spark--trail">✦</span>
      <span class="agent-working-glyph__spark agent-working-glyph__spark--core">✦</span>
    </span>
    <span class="type-meta">{label}</span>
  </span>
</div>
