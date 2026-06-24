<script lang="ts">
  import type { ComponentProps, Snippet } from "svelte";
  import { Dialog as SheetPrimitive } from "bits-ui";
  import Content from "./sheet-content.svelte";
  import { createSheetDrag } from "@/shared/gestures/sheet-drag";
  import { cn } from "@/shared/lib/utils";

  let {
    children,
    class: className,
    style,
    ...restProps
  }: ComponentProps<typeof Content> & { children: Snippet } = $props();

  const keyboardSafePadding = "padding-bottom: calc(env(safe-area-inset-bottom) + var(--keyboard-bottom-inset, 0px) + 0.5rem)";

  let sheetRef = $state<HTMLElement | null>(null);
  let grabber = $state<HTMLElement | null>(null);
  let closeRef = $state<HTMLButtonElement | null>(null);

  // The sheet only exists in the DOM while open, so wire the gesture
  // reactively off the refs rather than onMount.
  $effect(() => {
    const handleEl = grabber;
    const sheetEl = sheetRef;
    if (!handleEl || !sheetEl) return;
    const drag = createSheetDrag(handleEl, {
      sheet: sheetEl,
      onDismiss: () => closeRef?.click(),
    });
    return () => drag.destroy();
  });
</script>

<Content
  bind:ref={sheetRef}
  side="bottom"
  class={cn(
    "flex flex-col gap-0 overflow-hidden rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none",
    className,
  )}
  style={style ? `${keyboardSafePadding}; ${style}` : keyboardSafePadding}
  {...restProps}
>
  <div bind:this={grabber} class="flex w-full shrink-0 touch-none items-center justify-center pt-2.5 pb-1" aria-hidden="true">
    <div class="h-1 w-9 rounded-full bg-[color:var(--color-border-strong)]"></div>
  </div>
  {@render children()}
  <SheetPrimitive.Close bind:ref={closeRef} class="hidden" tabindex={-1} aria-hidden="true" />
</Content>
