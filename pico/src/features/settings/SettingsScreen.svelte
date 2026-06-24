<script lang="ts">
  import { onMount } from "svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import AppearanceCard from "@/features/settings/components/AppearanceCard.svelte";
  import HostStatusCard from "@/features/settings/components/HostStatusCard.svelte";
  import ManualHostConnectCard from "@/features/settings/components/ManualHostConnectCard.svelte";
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
    <Button type="button" variant="ghost" size="sm" onclick={() => navigateTo(routePaths.sessions, "pop")}>
      back
    </Button>
    <h1 class="type-title font-medium">settings</h1>
    <div class="w-12" aria-hidden="true"></div>
  </header>

  <div class="min-h-0 flex-1 space-y-7 overflow-y-auto px-3 pt-4" style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem)">
    {#if settingsState.error}
      <div class="type-meta rounded-[var(--radius-md)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[color:var(--color-danger)]">
        {settingsState.error}
      </div>
    {/if}

    {#if settingsState.loaded}
      <AppearanceCard />

      {#if settingsState.hostUrlConfigured}
        <HostStatusCard />
        <ManualHostConnectCard />
      {:else}
        <ManualHostConnectCard />
        <HostStatusCard />
      {/if}

      <section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
        <div class="mb-2">
          <h2 class="type-title font-medium text-[color:var(--color-fg)]">Pico</h2>
          <p class="type-copy mt-1 text-[color:var(--color-fg-muted)]">Pi, from your pocket.</p>
        </div>
        <p class="type-meta text-[color:var(--color-fg-muted)]">
          Pico is an independent, unofficial mobile client built on the Pi coding agent. It is not affiliated with or endorsed by Earendil Inc. or the Pi project.
        </p>
      </section>
    {:else}
      <div class="type-copy py-8 text-center text-[color:var(--color-fg-muted)]">loading settings…</div>
    {/if}
  </div>
</main>
</EdgeSwipeBack>
