<script lang="ts">
  import "photoswipe/style.css";
  import { createImageViewer, type ImageViewer, type ImageZoom } from "./image-viewer";

  let { src, label, loaded, failure, onload, onerror }: { src: string; label: string; loaded: boolean; failure: boolean; onload: (event: Event) => void; onerror: () => void } = $props();
  let pane = $state<HTMLDivElement | null>(null);
  let image = $state<HTMLImageElement | null>(null);
  let controls = $state<ImageViewer | null>(null);
  let zoom = $state<ImageZoom>({ zoom: 1, maxZoom: 1 });
  const helpId = `image-help-${crypto.randomUUID()}`;
  const accessibleControl = "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded focus:bg-[color:var(--color-bg)] focus:px-3 focus:ring-1";

  $effect(() => {
    src;
    if (!pane || !image || !loaded || failure) return;
    const viewer = createImageViewer(pane, image, (value) => (zoom = value), onerror);
    controls = viewer;
    return () => { viewer.destroy(); controls = null; };
  });
</script>

<div class="relative">
  <img bind:this={image} {src} alt={label} aria-hidden="true" decoding="async" {onload} {onerror} class="hidden" />
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div bind:this={pane} role="region" aria-label={`Image preview: ${label}`} aria-describedby={helpId} aria-busy={!loaded && !failure} tabindex="0" data-image-zoom={zoom.zoom} class="image-viewport relative h-[55dvh] touch-none overflow-hidden overscroll-contain rounded-[var(--radius-sm)] bg-[color:var(--color-surface)] select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:outline-none">
    <p id={helpId} class="sr-only">pinch to zoom; drag or scroll to pan. double-tap to zoom in or return to fit. use control or command plus scroll to zoom. when focused, use plus and minus to zoom, arrow keys to pan, and zero to reset.</p>
    {#if !loaded && !failure}<p class="type-meta absolute left-3 top-3 text-[color:var(--color-fg-muted)]" role="status">opening image…</p>{/if}
  </div>
  <button type="button" class={accessibleControl} disabled={!loaded || zoom.zoom >= zoom.maxZoom} onclick={() => controls?.zoomIn()}>zoom in</button>
  <button type="button" class={accessibleControl} disabled={!loaded || zoom.zoom <= 1} onclick={() => controls?.zoomOut()}>zoom out</button>
  <button type="button" class={accessibleControl} disabled={!loaded || zoom.zoom <= 1} onclick={() => controls?.reset()}>reset image zoom</button>
</div>

<style>
  .image-viewport :global(.pswp) {
    position: absolute;
    inset: 0;
    z-index: 0;
  }
</style>
