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

  let row = $state<HTMLDivElement | null>(null);
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

<!-- Besides a swipe, a right-click or keyboard focus reveals the actions, and focus leaving the row hides them. -->
<div
  bind:this={row}
  data-swipe-action-row
  class="hairline-b relative overflow-hidden bg-[color:var(--color-bg)]"
  onfocusout={(event) => {
    if (open && !row?.contains(event.relatedTarget as Node | null)) onClose();
  }}
>
  <div class="absolute inset-y-0 right-0 flex" onfocusin={() => open || onOpen()}>{@render actions?.()}</div>
  <div
    bind:this={surface}
    role="presentation"
    class="bg-[color:var(--color-bg)]"
    oncontextmenu={(event) => {
      event.preventDefault();
      if (open) onClose();
      else onOpen();
    }}
  >
    {@render children?.()}
  </div>
</div>
