<script lang="ts">
  import { onMount, setContext } from "svelte";
  import { appLifecycle } from "@/shared/mobile/lifecycle.svelte";

  let { children } = $props();

  setContext("app-lifecycle", appLifecycle);

  onMount(() => {
    appLifecycle.install();
  });
</script>

{@render children?.()}
