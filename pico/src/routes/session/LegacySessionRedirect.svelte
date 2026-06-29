<script lang="ts">
  import { onMount } from "svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { hostRegistryState } from "@/features/hosts/host-registry.state.svelte";

  let { id }: { id: string } = $props();

  onMount(() => {
    void (async () => {
      if (!hostRegistryState.loaded) await hostRegistryState.load();
      const hostId = hostRegistryState.defaultHostId;
      navigateTo(hostId ? routePaths.session(hostId, id) : routePaths.welcome, "replace");
    })();
  });
</script>

<main class="flex h-full items-center justify-center px-6 text-center">
  <p class="type-copy text-[color:var(--color-fg-muted)]">opening session…</p>
</main>
