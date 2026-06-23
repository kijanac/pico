<script lang="ts">
  import { onMount } from "svelte";
  import { ArrowRight, Loader2 } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { connectAndClaimHost } from "@/features/onboarding/api";
  import SettingsField from "@/features/settings/components/SettingsField.svelte";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import HostIssuePanel from "@/shared/components/HostIssuePanel.svelte";
  import { classifyHostIssue, type HostIssue } from "@/shared/lib/host-issues";
  import { runAt } from "@/shared/lib/rpc-client";
  import { haptics } from "@/shared/mobile/haptics";
  import { Button } from "@/shared/ui/button";

  let showConnect = $state(false);
  let url = $state("");
  let connecting = $state(false);
  let connectIssue = $state<HostIssue | null>(null);

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
    connectIssue = null;
    try {
      await runAt(candidate, connectAndClaimHost(candidate));
      haptics.success();
      navigateTo(routePaths.sessions, "replace");
    } catch (caught) {
      connectIssue = classifyHostIssue(caught, { url: candidate });
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
        pi runs on your machine. pico streams its sessions to your phone over your tailnet — no cloud in between.
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
    <div class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
      <p class="type-label uppercase tracking-[0.08em] text-[color:var(--color-accent)]">recommended</p>
      <p class="type-copy mt-1 text-[color:var(--color-fg)]">On your machine, run:</p>
      <code class="mt-2 block rounded-[var(--radius-md)] bg-[color:var(--color-bg)] px-3 py-2 font-mono text-[13px] text-[color:var(--color-fg)]">pico doctor && pico pair</code>
      <p class="type-meta mt-2 text-[color:var(--color-fg-muted)]">Then scan the QR with your phone camera or open the pico:// link.</p>
    </div>

    {#if showConnect}
      <div class="space-y-2 rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
        <SettingsField
          id="existing_host_url"
          label="host URL"
          bind:value={url}
          placeholder="pico-host-ab12cd.tailabc123.ts.net"
          onValue={(next) => (url = next)}
        />
        {#if connectIssue}
          <HostIssuePanel issue={connectIssue} />
        {/if}
        <Button type="button" variant="outline" class="h-10 w-full" disabled={connecting || !url.trim()} onclick={connect}>
          {#if connecting}<Loader2 class="size-3.5 animate-spin" /> connecting…{:else}connect manually{/if}
        </Button>
      </div>
    {:else}
      <Button type="button" class="h-11 w-full" onclick={() => (showConnect = true)}>
        enter host URL manually
        <ArrowRight class="size-3.5" />
      </Button>
    {/if}

    <Button type="button" variant="outline" class="h-11 w-full" onclick={() => navigateTo(routePaths.onboarding)}>
      advanced: create cloud host
    </Button>

    <button type="button" class="type-meta py-1 text-center text-[color:var(--color-fg-faint)] active:opacity-70" onclick={() => void skip()}>
      skip for now
    </button>
  </div>
</main>
