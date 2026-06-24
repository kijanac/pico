<script lang="ts">
  import MobileViewport from "@/app/shell/MobileViewport.svelte";
  import AppLifecycle from "@/app/shell/AppLifecycle.svelte";
  import KeyboardBoundary from "@/app/shell/KeyboardBoundary.svelte";

  let { children } = $props();
</script>

<MobileViewport>
  <AppLifecycle>
    <KeyboardBoundary mode="manual">
      {@render children?.()}
    </KeyboardBoundary>
  </AppLifecycle>
</MobileViewport>
