<script lang="ts">
  import { onMount } from "svelte";
  import { keyboardState } from "@/shared/mobile/keyboard.svelte";
  import { installKeyboardFocus } from "@/shared/mobile/keyboard-focus";

  let { children } = $props();
  const viewport = $derived(keyboardState.viewport);
  onMount(() => {
    const releaseViewport = keyboardState.install();
    const releaseFocus = installKeyboardFocus();
    return () => {
      releaseFocus();
      releaseViewport();
    };
  });
</script>

<div
  class="fixed h-dvh w-full overflow-hidden bg-[color:var(--color-bg)] text-[color:var(--color-fg)] antialiased"
  style:top={`${viewport?.top ?? 0}px`}
  style:left={`${viewport?.left ?? 0}px`}
  style:width={viewport ? `${viewport.width}px` : "100%"}
  style:height={viewport ? `${viewport.height}px` : "100dvh"}
  style:padding-left="env(safe-area-inset-left)"
  style:padding-right="env(safe-area-inset-right)"
  data-mobile-viewport
>
  <div class="flex h-full min-h-0 w-full flex-col overflow-hidden">
    {@render children?.()}
  </div>
</div>

<style>
  :global(html),
  :global(body),
  :global(#root) {
    position: fixed;
    inset: 0;
    overflow: clip;
  }
</style>
