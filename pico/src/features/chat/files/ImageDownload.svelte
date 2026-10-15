<script lang="ts">
  import { Download } from "@lucide/svelte";
  import { Button } from "@/shared/ui/button";

  let { href, filename }: { href: string; filename: string } = $props();
</script>

<Button {href} download={filename} variant="ghost" size="icon" aria-label="Download image" title="download image" class="absolute top-1 right-12 size-11 text-[color:var(--color-fg-muted)]">
  <Download class="size-4" aria-hidden="true" />
</Button>
