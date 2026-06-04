<script lang="ts">
  import { onMount } from "svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import BridgeStatusCard from "@/features/settings/components/BridgeStatusCard.svelte";
  import GuidedOnboardingCard from "@/features/settings/components/GuidedOnboardingCard.svelte";
  import { Button } from "@/shared/ui/button";
  import EdgeSwipeBack from "@/shared/components/EdgeSwipeBack.svelte";
  import HomePreview from "@/features/sessions/components/HomePreview.svelte";

  onMount(() => {
    void settingsState.load();
  });
</script>

<EdgeSwipeBack href="/">
  {#snippet preview()}
    <HomePreview />
  {/snippet}

<main class="flex min-h-0 flex-1 flex-col">
  <header class="flex items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-3 py-[calc(env(safe-area-inset-top)+12px)] pb-3">
    <Button type="button" variant="ghost" size="sm" onclick={() => navigateTo(routePaths.sessions)}>
      back
    </Button>
    <h1 class="text-title font-medium">settings</h1>
    <div class="w-12" aria-hidden="true"></div>
  </header>

  <div class="min-h-0 flex-1 space-y-7 overflow-y-auto px-3 pt-4" style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem)">
    {#if settingsState.error}
      <div class="text-meta rounded-[var(--radius-md)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[color:var(--color-danger)]">
        {settingsState.error}
      </div>
    {/if}

    {#if settingsState.loaded}
      {#if settingsState.bridgeUrlConfigured}
        <BridgeStatusCard />
        <GuidedOnboardingCard />
      {:else}
        <GuidedOnboardingCard />
        <BridgeStatusCard />
      {/if}
    {:else}
      <div class="text-copy py-8 text-center text-[color:var(--color-fg-muted)]">loading settings…</div>
    {/if}
  </div>
</main>
</EdgeSwipeBack>
