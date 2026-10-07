<script lang="ts">
  let { children } = $props();
</script>

<div
  class="h-dvh overflow-hidden bg-[color:var(--color-bg)] text-[color:var(--color-fg)] antialiased"
  data-mobile-viewport
>
  <div class="flex h-full min-h-0 w-full flex-col overflow-hidden" data-app-frame>
    {@render children?.()}
  </div>
</div>
