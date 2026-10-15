<script lang="ts">
  import { Button } from "@/shared/ui/button";
  import ImageViewport from "./ImageViewport.svelte";

  let { src, label }: { src: string; label: string } = $props();
  let loaded = $state(false);
  let failure = $state(false);
  let attempt = $state(0);
  const previewId = crypto.randomUUID();
  const attemptedSrc = $derived(src.startsWith("data:") ? src : `${src}${src.includes("?") ? "&" : "?"}preview=${previewId}&retry=${attempt}`);

  $effect(() => { src; loaded = false; failure = false; attempt = 0; });

  function retry(): void { failure = false; loaded = false; attempt += 1; }
  function imageLoaded(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    loaded = image.naturalWidth > 0 && image.naturalHeight > 0;
    failure = !loaded;
  }
</script>

<div class="space-y-2">
  {#if failure}
    <div role="alert" class="type-copy text-[color:var(--color-fg-muted)]">
      <p>couldn't load this image</p>
      <Button variant="ghost" size="sm" class="min-h-11" onclick={retry}>try again</Button>
    </div>
  {/if}
  {#key attempt}
    <ImageViewport src={attemptedSrc} {label} {loaded} {failure} onload={imageLoaded} onerror={() => { failure = true; loaded = false; }} />
  {/key}
</div>
