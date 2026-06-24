<script lang="ts">
  import { onMount } from "svelte";
  import { createSwipeActionRow } from "@/shared/gestures/swipe-action";

  let {
    open,
    actionWidth,
    actionCount,
    actions,
    children,
    onOpen,
    onClose,
  }: {
    open: boolean;
    actionWidth: number;
    actionCount: number;
    actions?: import("svelte").Snippet;
    children?: import("svelte").Snippet;
    onOpen: () => void;
    onClose: () => void;
  } = $props();

  let surface = $state<HTMLDivElement | null>(null);
  let gesture: ReturnType<typeof createSwipeActionRow> | null = null;

  onMount(() => {
    if (!surface) return;
    gesture = createSwipeActionRow(surface, {
      actionWidth: () => actionWidth,
      actionCount: () => actionCount,
      isOpen: () => open,
      onOpen: () => onOpen(),
      onClose: () => onClose(),
    });
    return () => gesture?.destroy();
  });

  $effect(() => {
    open;
    actionWidth;
    actionCount;
    gesture?.render();
  });
</script>

<div data-swipe-action-row class="hairline-b relative overflow-hidden bg-[color:var(--color-bg)]">
  <div class="absolute inset-y-0 right-0 flex">{@render actions?.()}</div>
  <div bind:this={surface} class="bg-[color:var(--color-bg)]">
    {@render children?.()}
  </div>
</div>
