<script lang="ts">
  import { keyboardState } from "@/shared/mobile/keyboard.svelte";

  let { children }: { children?: import("svelte").Snippet } = $props();

  $effect(() => {
    const viewport = keyboardState.viewport;
    const root = document.documentElement;
    root.style.setProperty("--keyboard-bottom-inset", `${viewport?.bottom ?? 0}px`);
    root.style.setProperty("--app-viewport-height", viewport ? `${viewport.height}px` : "100dvh");
    root.style.setProperty("--app-safe-bottom", keyboardState.height > 0 ? "0px" : "env(safe-area-inset-bottom)");
    return () => {
      root.style.removeProperty("--keyboard-bottom-inset");
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-safe-bottom");
    };
  });
</script>

<div class="flex min-h-0 flex-1 flex-col">
  {@render children?.()}
</div>
