<script lang="ts">
  import { onMount } from "svelte";
  import { Loader2 } from "@lucide/svelte";
  import { createPullToRefresh } from "@/shared/gestures/pull-to-refresh";

  let {
    onRefresh,
    class: className = "",
    children,
  }: {
    onRefresh: () => Promise<void>;
    class?: string;
    children?: import("svelte").Snippet;
  } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let content = $state<HTMLDivElement | null>(null);
  let indicator = $state<HTMLDivElement | null>(null);
  let icon = $state<HTMLDivElement | null>(null);

  onMount(() => {
    if (!container || !content || !indicator || !icon) return;
    const gesture = createPullToRefresh(container, {
      content,
      indicator,
      icon,
      onRefresh: () => onRefresh(),
    });
    return () => gesture.destroy();
  });
</script>

<div bind:this={container} class={`relative overflow-y-auto ${className}`} style="overscroll-behavior-y: contain">
  <div bind:this={indicator} class="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-center justify-center">
    <div bind:this={icon} class="text-[color:var(--color-fg-muted)]">
      <Loader2 class="size-4" />
    </div>
  </div>

  <div bind:this={content}>
    {@render children?.()}
  </div>
</div>
