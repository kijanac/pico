<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "@/app/shell/AppShell.svelte";
  import SessionsPage from "@/routes/sessions/SessionsPage.svelte";
  import { consumeNavKind, currentPath, resolveRoute, type RouteMatch } from "@/app/routes";
  import { themeState } from "@/shared/theme/theme.svelte";

  // The landing route ships with the entry (no extra round trip on launch);
  // the others load right after launch, so a first visit doesn't slide in an
  // empty screen.
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

  const loadSession = lazy(() => import("@/routes/session/SessionPage.svelte"));
  const loadSettings = lazy(() => import("@/routes/settings/SettingsPage.svelte"));

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

  // The screens slide on phones. With a mouse they'd sweep across a wide
  // window's empty margins, so desktop navigates instantly.
  function slides(): boolean {
    return !window.matchMedia("(prefers-reduced-motion: reduce), (pointer: fine)").matches;
  }

  // The leaving screen stays the same instance, so it slides away as it was.
  const layers = $derived(leaving ? [leaving.screen, current] : [current]);

  function settle(): void {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    leaving = null;
    enterKind = null;
  }

  function syncRoute() {
    const kind = consumeNavKind();
    const path = currentPath();
    if (path === current.path) return;

    const animate = (kind === "push" || kind === "pop") && slides();

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
    themeState.init();
    setTimeout(() => {
      void loadSession();
      void loadSettings();
    });

    window.addEventListener("popstate", syncRoute);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      if (settleTimer) clearTimeout(settleTimer);
    };
  });
</script>

{#snippet screenContent(route: RouteMatch)}
  {#if route.id === "sessions"}
    <SessionsPage />
  {:else if route.id === "session"}
    {#await loadSession() then { default: SessionPage }}
      <SessionPage id={route.params.id} />
    {/await}
  {:else if route.id === "settings"}
    {#await loadSettings() then { default: SettingsPage }}
      <SettingsPage />
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
    <!-- The leaving screen stays first, so no layer moves in the DOM; a pop's leaving screen stacks above with z-index. -->
    {#each layers as screen (screen.key)}
      {@const exit = leaving && screen.key === leaving.screen.key ? leaving.kind : null}
      <div
        class="screen-layer"
        class:nav-exit-push={exit === "push"}
        class:nav-exit-pop={exit === "pop"}
        class:nav-enter-push={!exit && enterKind === "push"}
        class:nav-enter-pop={!exit && enterKind === "pop"}
        aria-hidden={exit ? "true" : undefined}
        inert={!!exit}
      >
        {@render screenContent(screen.route)}
      </div>
    {/each}
  </div>
</AppShell>
