<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "@/app/shell/AppShell.svelte";
  import SessionsPage from "@/routes/sessions/SessionsPage.svelte";
  import SessionPage from "@/routes/session/SessionPage.svelte";
  import SettingsPage from "@/routes/settings/SettingsPage.svelte";
  import { currentPath, matchRoute, type RouteMatch } from "@/app/routes";

  // Onboarding is visited once per install; loading it lazily keeps its code
  // (embla carousel, cloud-init template) out of the startup chunk.
  let onboardingModule: Promise<typeof import("@/routes/onboarding/OnboardingPage.svelte")> | null = null;
  const loadOnboarding = () => (onboardingModule ??= import("@/routes/onboarding/OnboardingPage.svelte"));

  let route = $state<RouteMatch>(matchRoute(currentPath()));

  function syncRoute() {
    route = matchRoute(currentPath());
  }

  onMount(() => {
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  });
</script>

<AppShell>
  {#if route.id === "sessions"}
    <SessionsPage />
  {:else if route.id === "session"}
    <SessionPage id={route.params.id} />
  {:else if route.id === "settings"}
    <SettingsPage />
  {:else if route.id === "onboarding"}
    {#await loadOnboarding() then { default: OnboardingPage }}
      <OnboardingPage />
    {/await}
  {:else}
    <main class="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p class="type-title font-medium">route not found</p>
      <p class="type-meta text-[color:var(--color-fg-muted)]">{route.params.path}</p>
    </main>
  {/if}
</AppShell>
