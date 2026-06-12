<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "@/app/shell/AppShell.svelte";
  import { currentPath, matchRoute, type RouteMatch } from "@/app/routes";

  // Every route loads lazily so the startup chunk holds only the shell;
  // chunks come from local disk in Capacitor, so the first-visit cost is tiny.
  function lazy<T>(load: () => Promise<T>): () => Promise<T> {
    let module: Promise<T> | null = null;
    return () => (module ??= load());
  }

  const loadSessions = lazy(() => import("@/routes/sessions/SessionsPage.svelte"));
  const loadSession = lazy(() => import("@/routes/session/SessionPage.svelte"));
  const loadSettings = lazy(() => import("@/routes/settings/SettingsPage.svelte"));
  const loadOnboarding = lazy(() => import("@/routes/onboarding/OnboardingPage.svelte"));

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
    {#await loadSessions() then { default: SessionsPage }}
      <SessionsPage />
    {/await}
  {:else if route.id === "session"}
    {#await loadSession() then { default: SessionPage }}
      <SessionPage id={route.params.id} />
    {/await}
  {:else if route.id === "settings"}
    {#await loadSettings() then { default: SettingsPage }}
      <SettingsPage />
    {/await}
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
