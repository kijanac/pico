<script lang="ts">
  import { onMount } from "svelte";
  import { keyboardState } from "@/shared/mobile/keyboard.svelte";

  let { children }: { children?: import("svelte").Snippet } = $props();

  // On :root because the bottom sheet that reads it is portaled out of this tree.
  $effect(() => {
    document.documentElement.style.setProperty("--keyboard-bottom-inset", `${keyboardState.height}px`);
    return () => document.documentElement.style.removeProperty("--keyboard-bottom-inset");
  });

  onMount(() => {
    keyboardState.install();
  });
</script>

<div class="flex min-h-0 flex-1 flex-col" style:padding-bottom={`${keyboardState.height}px`}>
  {@render children?.()}
</div>
