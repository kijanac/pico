<script lang="ts">
  import { onMount } from "svelte";
  import { keyboardState } from "@/shared/mobile/keyboard.svelte";

  let { children }: { children?: import("svelte").Snippet } = $props();

  const bottomInset = $derived(keyboardState.height);

  $effect(() => {
    document.documentElement.style.setProperty("--keyboard-bottom-inset", `${bottomInset}px`);
    return () => document.documentElement.style.removeProperty("--keyboard-bottom-inset");
  });

  onMount(() => {
    keyboardState.install();
  });
</script>

<div
  class="flex min-h-0 flex-1 flex-col"
  style:--keyboard-bottom-inset={`${bottomInset}px`}
  style:padding-bottom={`${bottomInset}px`}
>
  {@render children?.()}
</div>
