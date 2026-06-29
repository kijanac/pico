<script lang="ts">
  import { onMount } from "svelte";
  import { App as CapacitorApp } from "@capacitor/app";
  import { Capacitor } from "@capacitor/core";
  import AppShell from "@/app/shell/AppShell.svelte";
  import { consumeNavKind, currentPath, resolveRoute, openAppUrl, type RouteMatch } from "@/app/routes";
  import { themeState } from "@/shared/theme/theme.svelte";

  // Chunks load from local disk in Capacitor, so lazy routes cost ~nothing.
  function lazy<T>(load: () => Promise<T>): () => Promise<T> {
    let cached: Promise<T> | null = null;
    return () => {
      if (!cached) {
        cached = load();
        // Don't cache a failed import; let the next render retry.
        cached.catch(() => (cached = null));
      }
      return cached;
    };
  }

  const loadSessions = lazy(() => import("@/routes/sessions/SessionsPage.svelte"));
  const loadSession = lazy(() => import("@/routes/session/SessionPage.svelte"));
  const loadSettings = lazy(() => import("@/routes/settings/SettingsPage.svelte"));
  const loadConnect = lazy(() => import("@/routes/connect/ConnectPage.svelte"));
  const loadWelcome = lazy(() => import("@/routes/welcome/WelcomePage.svelte"));

  const NAV_TRANSITION_MS = 280;

  interface Screen {
    key: number;
    path: string;
    route: RouteMatch;
  }

  let screenKey = 0;
  let current = $state<Screen>({ key: screenKey, path: currentPath(), route: resolveRoute(currentPath()) });
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
    current = { key: ++screenKey, path, route: resolveRoute(path) };

    if (animate) {
      leaving = { screen: outgoing, kind };
      enterKind = kind;
      settleTimer = setTimeout(settle, NAV_TRANSITION_MS + 30);
    }
  }

  onMount(() => {
    let appUrlOpenHandle: { remove: () => Promise<void> } | null = null;

    themeState.init();
    void themeState.load();

    window.addEventListener("popstate", syncRoute);
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.getLaunchUrl().then((launch) => {
        if (launch?.url) openAppUrl(launch.url);
      });
      void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
        openAppUrl(url);
      }).then((handle) => {
        appUrlOpenHandle = handle;
      });
    }

    return () => {
      window.removeEventListener("popstate", syncRoute);
      void appUrlOpenHandle?.remove();
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
      <SessionPage hostId={route.params.hostId} id={route.params.id} />
    {/await}
  {:else if route.id === "settings"}
    {#await loadSettings() then { default: SettingsPage }}
      <SettingsPage />
    {/await}
  {:else if route.id === "connect"}
    {#await loadConnect() then { default: ConnectPage }}
      <ConnectPage />
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
    <!-- DOM order controls stacking: push renders the new screen over the old; pop renders the old over the new. -->
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
