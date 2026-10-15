<script lang="ts">
  import type { ComponentProps, Snippet } from "svelte";
  import { wideSheetViewport } from "./sheet-layout";
  import { Dialog as SheetPrimitive } from "bits-ui";
  import Content from "./sheet-content.svelte";
  import { createSheetDrag } from "@/shared/gestures/sheet-drag";
  import { cn } from "@/shared/lib/utils";

  let {
    children,
    class: className,
    drawerSize = "default",
    ...restProps
  }: ComponentProps<typeof Content> & { children: Snippet; drawerSize?: "compact" | "default" | "wide" } = $props();

  let sheetRef = $state<HTMLElement | null>(null);
  let grabber = $state<HTMLElement | null>(null);
  let closeRef = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    const handleEl = grabber;
    const sheetEl = sheetRef;
    if (!handleEl || !sheetEl || wideSheetViewport.current) return;
    const drag = createSheetDrag(handleEl, {
      sheet: sheetEl,
      onDismiss: () => closeRef?.click(),
    });
    return () => drag.destroy();
  });
</script>

<Content
  bind:ref={sheetRef}
  class={cn(
    "column flex max-h-[min(var(--sheet-max-height,100dvh),var(--sheet-available-height))] flex-col gap-0 overflow-hidden rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none",
    className,
  )}
  {...restProps}
  data-sheet-side={wideSheetViewport.current ? "right" : "bottom"}
  data-sheet-size={drawerSize}
>
  <div bind:this={grabber} data-sheet-grabber class="flex w-full shrink-0 touch-none items-center justify-center pt-2.5 pb-1" aria-hidden="true">
    <div class="h-1 w-9 rounded-full bg-[color:var(--color-border-strong)]"></div>
  </div>
  {@render children()}
  <SheetPrimitive.Close bind:ref={closeRef} class="hidden" tabindex={-1} aria-hidden="true" />
</Content>

<style>
  :global([data-slot="sheet-content"][data-sheet-side]) {
    --sheet-available-height: max(0px, calc(var(--app-viewport-height, 100dvh) - env(safe-area-inset-top)));
    bottom: var(--keyboard-bottom-inset, 0px);
    padding-bottom: calc(var(--app-safe-bottom, env(safe-area-inset-bottom)) + 0.5rem);
  }

  :global([data-slot="sheet-content"][data-sheet-side="right"]) {
    --tw-enter-translate-x: 100%;
    --tw-enter-translate-y: 0;
    --tw-exit-translate-x: 100%;
    --tw-exit-translate-y: 0;
    left: auto;
    right: env(safe-area-inset-right);
    width: 28rem;
    max-width: calc(100vw - 24rem - env(safe-area-inset-right));
    height: var(--sheet-available-height);
    max-height: var(--sheet-available-height);
    margin-inline: 0;
    border-top-width: 0;
    border-left-width: 1px;
    border-radius: 0;
  }

  :global([data-slot="sheet-content"][data-sheet-side="right"][data-sheet-size="compact"]) {
    width: 24rem;
  }

  :global([data-slot="sheet-content"][data-sheet-side="right"][data-sheet-size="wide"]) {
    width: 48rem;
  }

  :global([data-sheet-side="right"] > [data-slot="sheet-header"]) {
    min-height: 3.5rem;
  }

  :global([data-sheet-side="right"] > [data-sheet-grabber]) {
    display: none;
  }
</style>
