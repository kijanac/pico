<script lang="ts">
  import MobileViewport from "@/app/shell/MobileViewport.svelte";
  import KeyboardBoundary from "@/app/shell/KeyboardBoundary.svelte";

  let { children } = $props();
</script>

<MobileViewport>
  <KeyboardBoundary>
    {@render children?.()}
  </KeyboardBoundary>
</MobileViewport>
