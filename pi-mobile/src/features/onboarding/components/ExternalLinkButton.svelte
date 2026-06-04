<script lang="ts">
  import { ExternalLink } from "@lucide/svelte";

  let { href, children }: { href: string; children?: import("svelte").Snippet } = $props();
</script>

<a href={href} target="_blank" rel="noreferrer" class="text-meta flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-strong)] active:bg-[color:var(--color-bg)]">
  {@render children?.()}
  <ExternalLink class="size-3.5" />
</a>
