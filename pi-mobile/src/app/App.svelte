<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "@/app/shell/AppShell.svelte";
  import { consumeNavKind, currentPath, matchRoute, type RouteMatch } from "@/app/routes";

  // Chunks load from local disk in Capacitor, so lazy routes cost ~nothing on first visit.
  function lazy<T>(load: () => Promise<T>): () => Promise<T> {
    let cached: Promise<T> | null = null;
    return () => {
      if (!cached) {
        cached = load();
        // Don't cache a failed import; the next render retries it.
        cached.catch(() => (cached = null));
      }
      return cached;
    };
  }

  const loadSessions = lazy(() => import("@/routes/sessions/SessionsPage.svelte"));
  const loadSession = lazy(() => import("@/routes/session/SessionPage.svelte"));
  const loadSettings = lazy(() => import("@/routes/settings/SettingsPage.svelte"));
  const loadOnboarding = lazy(() => import("@/routes/onboarding/OnboardingPage.svelte"));
  const loadWelcome = lazy(() => import("@/routes/welcome/WelcomePage.svelte"));

  const NAV_TRANSITION_MS = 280;

  interface Screen {
    key: number;
    path: string;
    route: RouteMatch;
  }

  let screenKey = 0;
  let current = $state<Screen>({ key: screenKey, path: currentPath(), route: matchRoute(currentPath()) });
  let leaving = $state<{ screen: Screen; kind: "push" | "pop" } | null>(null);
  let enterKind = $state<"push" | "pop" | null>(null);
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  function reducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function settle(): void {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    leaving = null;
    enterKind = null;
  }

  function syncRoute() {
    const path = currentPath();
    if (path === current.path) return;

    const kind = consumeNavKind();
    const animate = (kind === "push" || kind === "pop") && !reducedMotion();

    settle();
    const outgoing = current;
    current = { key: ++screenKey, path, route: matchRoute(path) };

    if (animate) {
      leaving = { screen: outgoing, kind };
      enterKind = kind;
      settleTimer = setTimeout(settle, NAV_TRANSITION_MS + 30);
    }
  }

  onMount(() => {
    window.addEventListener("popstate", syncRoute);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      if (settleTimer) clearTimeout(settleTimer);
    };
  });
</script>

{#snippet screenContent(route: RouteMatch)}
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
  {:else if route.id === "welcome"}
    {#await loadWelcome() then { default: WelcomePage }}
      <WelcomePage />
    {/await}
  {:else}
    <main class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p class="type-title font-medium">route not found</p>
      <p class="type-meta text-[color:var(--color-fg-muted)]">{route.params.path}</p>
    </main>
  {/if}
{/snippet}

<AppShell>
  <div class="nav-stack">
    <!-- DOM order controls stacking: a push slides the new screen in over the
         old one; a pop slides the old screen away revealing the new beneath. -->
    {#if leaving && leaving.kind === "push"}
      {#key leaving.screen.key}
        <div class="screen-layer nav-exit-push" aria-hidden="true" inert>
          {@render screenContent(leaving.screen.route)}
        </div>
      {/key}
    {/if}

    {#key current.key}
      <div class="screen-layer" class:nav-enter-push={enterKind === "push"} class:nav-enter-pop={enterKind === "pop"}>
        {@render screenContent(current.route)}
      </div>
    {/key}

    {#if leaving && leaving.kind === "pop"}
      {#key leaving.screen.key}
        <div class="screen-layer nav-exit-pop" aria-hidden="true" inert>
          {@render screenContent(leaving.screen.route)}
        </div>
      {/key}
    {/if}
  </div>
</AppShell>
