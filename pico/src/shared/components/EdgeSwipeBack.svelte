<script lang="ts">
  import { onMount } from "svelte";
  import { navigateTo } from "@/app/routes";
  import { createEdgeSwipeBack } from "@/shared/gestures/edge-swipe";

  let {
    href,
    preview,
    children,
  }: {
    href: string;
    preview?: import("svelte").Snippet;
    children?: import("svelte").Snippet;
  } = $props();

  let page = $state<HTMLDivElement | null>(null);
  let previewEl = $state<HTMLDivElement | null>(null);
  let shade = $state<HTMLDivElement | null>(null);
  let previewMounted = $state(false);

  onMount(() => {
    if (!page || !previewEl || !shade) return;
    const gesture = createEdgeSwipeBack({
      page,
      preview: previewEl,
      shade,
      onComplete: () => navigateTo(href, "swipe"),
      onPreviewNeeded: () => (previewMounted = true),
    });
    return () => gesture.destroy();
  });
</script>

<div class="edge-swipe-root flex h-full min-h-0 flex-col bg-[color:var(--color-bg)]">
  <div bind:this={previewEl} aria-hidden="true" class="edge-swipe-preview pointer-events-none fixed inset-0 z-0">
    {#if previewMounted}
      {@render preview?.()}
    {/if}
    <div bind:this={shade} class="edge-swipe-shade pointer-events-none fixed inset-0 opacity-100"></div>
  </div>
  <div bind:this={page} class="edge-swipe-page relative z-10 flex h-full min-h-0 flex-col bg-[color:var(--color-bg)]">
    {@render children?.()}
  </div>
</div>
