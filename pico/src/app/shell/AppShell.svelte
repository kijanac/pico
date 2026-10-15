<script lang="ts">
  import MobileViewport from "@/app/shell/MobileViewport.svelte";
  import KeyboardBoundary from "@/app/shell/KeyboardBoundary.svelte";
  import SessionExportReceipt from "@/features/chat/components/SessionExportReceipt.svelte";

  let { children } = $props();
</script>

<MobileViewport>
  <KeyboardBoundary>
    {@render children?.()}
    <SessionExportReceipt />
  </KeyboardBoundary>
</MobileViewport>
