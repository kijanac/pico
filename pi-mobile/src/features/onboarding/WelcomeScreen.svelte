<script lang="ts">
  import { onMount } from "svelte";
  import { ArrowRight, Loader2 } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { claimReachableBridge, healthcheckBridgeUrl } from "@/features/onboarding/api";
  import SettingsField from "@/features/settings/components/SettingsField.svelte";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import { haptics } from "@/shared/mobile/haptics";
  import { Button } from "@/shared/ui/button";

  let showConnect = $state(false);
  let url = $state("");
  let connecting = $state(false);
  let connectError = $state<string | null>(null);

  onMount(() => {
    if (!settingsState.loaded) void settingsState.load();
  });

  function normalizeCandidate(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  async function connect(): Promise<void> {
    const candidate = normalizeCandidate(url);
    if (!candidate || connecting) return;
    connecting = true;
    connectError = null;
    try {
      const reachable = await healthcheckBridgeUrl(candidate);
      if (!reachable) {
        connectError = "bridge not reachable — check the url and that tailscale is connected on this phone.";
        return;
      }
      await claimReachableBridge(candidate);
      await settingsState.setBridgeUrl(candidate);
      haptics.success();
      navigateTo(routePaths.sessions, "replace");
    } catch (caught) {
      connectError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      connecting = false;
    }
  }

  async function skip(): Promise<void> {
    await settingsState.skipWelcome();
    navigateTo(routePaths.sessions, "replace");
  }
</script>

<main class="flex min-h-0 flex-1 flex-col px-5 pt-[calc(env(safe-area-inset-top)+16px)]" style="padding-bottom: calc(env(safe-area-inset-bottom) + 1.25rem)">
  <div class="flex min-h-0 flex-1 flex-col justify-center gap-10 overflow-y-auto py-6">
    <div>
      <h1 class="font-mono text-[32px] leading-none font-medium tracking-tight">
        pico<span class="animate-pulse text-[color:var(--color-accent)]">▍</span>
      </h1>
      <p class="type-copy mt-3 max-w-[34ch] text-[color:var(--color-fg-muted)]">
        a pi coding agent runs on your server. pico streams its sessions to your phone over your tailnet — no cloud in between.
      </p>
    </div>

    <div aria-hidden="true" class="flex items-center gap-2 select-none">
      <span class="type-label uppercase tracking-[0.08em] shrink-0 text-[color:var(--color-fg)]">this phone</span>
      <span class="h-px flex-1 bg-[color:var(--color-border-strong)]"></span>
      <span class="type-label uppercase tracking-[0.08em] shrink-0 text-[color:var(--color-fg-faint)]">tailnet</span>
      <span class="h-px flex-1 bg-[color:var(--color-border-strong)]"></span>
      <span class="type-label uppercase tracking-[0.08em] shrink-0 text-[color:var(--color-fg)]">your box</span>
      <span class="size-1.5 shrink-0 rounded-full bg-[color:var(--color-accent)]"></span>
    </div>
  </div>

  <div class="flex shrink-0 flex-col gap-3">
    <div>
      <Button type="button" class="h-11 w-full" onclick={() => navigateTo(routePaths.onboarding)}>
        set up a new bridge
        <ArrowRight class="size-3.5" />
      </Button>
      <p class="type-meta mt-1.5 text-center text-[color:var(--color-fg-faint)]">fresh linux vps + tailscale · ~10 min</p>
    </div>

    {#if showConnect}
      <div class="space-y-2 rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
        <SettingsField
          id="existing_bridge_url"
          label="bridge url"
          bind:value={url}
          placeholder="pi-bridge-ab12cd.tailabc123.ts.net"
          onValue={(next) => (url = next)}
        />
        {#if connectError}
          <p class="type-meta text-[color:var(--color-danger)]">{connectError}</p>
        {/if}
        <Button type="button" variant="outline" class="h-10 w-full" disabled={connecting || !url.trim()} onclick={connect}>
          {#if connecting}<Loader2 class="size-3.5 animate-spin" /> connecting…{:else}connect{/if}
        </Button>
      </div>
    {:else}
      <Button type="button" variant="outline" class="h-11 w-full" onclick={() => (showConnect = true)}>
        connect to an existing bridge
      </Button>
    {/if}

    <button type="button" class="type-meta py-1 text-center text-[color:var(--color-fg-faint)] active:opacity-70" onclick={() => void skip()}>
      skip for now
    </button>
  </div>
</main>
