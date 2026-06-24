<script lang="ts">
  import { onMount } from "svelte";
  import { keyboardState, type KeyboardAvoidanceMode } from "@/shared/mobile/keyboard.svelte";

  let {
    children,
    mode = "manual",
  }: { children?: import("svelte").Snippet; mode?: KeyboardAvoidanceMode } = $props();

  const bottomInset = $derived(mode === "manual" ? keyboardState.height : 0);

  $effect(() => {
    document.documentElement.style.setProperty("--keyboard-bottom-inset", `${bottomInset}px`);
    return () => document.documentElement.style.removeProperty("--keyboard-bottom-inset");
  });

  onMount(() => {
    keyboardState.install();
    if (mode === "manual") keyboardState.acquireManualResize();

    return () => {
      if (mode === "manual") keyboardState.releaseManualResize();
    };
  });
</script>

<div
  class="flex min-h-0 flex-1 flex-col"
  data-keyboard-boundary
  data-keyboard-mode={mode}
  style:--keyboard-bottom-inset={`${bottomInset}px`}
  style:padding-bottom={`${bottomInset}px`}
>
  {@render children?.()}
</div>
