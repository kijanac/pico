<script lang="ts">
  import { Check, Loader2, X } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { claimReachableHost, healthcheckHostUrl } from "@/features/onboarding/api";
  import SettingsField from "@/features/settings/components/SettingsField.svelte";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import HostIssuePanel from "@/shared/components/HostIssuePanel.svelte";
  import { classifyHostIssue, type HostIssue } from "@/shared/lib/host-issues";
  import { runAt } from "@/shared/lib/rpc-client";
  import { haptics } from "@/shared/mobile/haptics";
  import { Button } from "@/shared/ui/button";

  type ConnectState = "idle" | "connecting" | "connected" | "failed";

  let hostUrl = $state("");
  let pairingToken = $state("");
  let connectState = $state<ConnectState>("idle");
  let message = $state("Paste the URL and pairing token printed by `pico pair`.");
  let issue = $state<HostIssue | null>(null);

  const canConnect = $derived(hostUrl.trim().length > 0 && connectState !== "connecting");

  async function connectHost(): Promise<void> {
    const url = hostUrl.trim();
    const token = pairingToken.trim() || undefined;
    if (!url || connectState === "connecting") return;

    connectState = "connecting";
    message = `Checking ${url}…`;
    issue = null;

    try {
      if (!settingsState.loaded) await settingsState.load();
      if (!(await healthcheckHostUrl(url))) {
        throw { hostErrorCode: "host_unreachable" };
      }

      message = "Claiming Pico host with your Tailscale identity…";
      await runAt(url, claimReachableHost(token));
      await settingsState.setHostUrl(url);

      connectState = "connected";
      message = "Pico host connected. Opening sessions…";
      haptics.success();
      window.setTimeout(() => navigateTo(routePaths.sessions, "replace"), 800);
    } catch (error) {
      connectState = "failed";
      issue = classifyHostIssue(error, { url });
      message = issue.message;
    }
  }
</script>

<section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <div class="mb-3">
    <h2 class="type-title font-medium text-[color:var(--color-fg)]">connect Pico host</h2>
    <p class="type-copy mt-1 text-[color:var(--color-fg-muted)]">
      Use this if you cannot open or scan the pairing link from your host terminal.
    </p>
  </div>

  <div class="space-y-3">
    <SettingsField id="manual_host_url" label="host URL" value={hostUrl} onValue={(value) => (hostUrl = value)} placeholder="https://host.tailnet.ts.net" />
    <SettingsField id="manual_pairing_token" label="pairing token" value={pairingToken} onValue={(value) => (pairingToken = value)} placeholder="printed by pico pair" secret />

    {#if connectState === "failed" && issue}
      <HostIssuePanel issue={issue} />
    {:else}
      <div class={`type-meta flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 ${connectState === "failed" ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-fg-muted)]"}`}>
      {#if connectState === "connecting"}<Loader2 class="mt-0.5 size-3.5 shrink-0 animate-spin" />{/if}
      {#if connectState === "connected"}<Check class="mt-0.5 size-3.5 shrink-0 text-[color:var(--color-accent)]" />{/if}
      {#if connectState === "failed"}<X class="mt-0.5 size-3.5 shrink-0" />{/if}
        <span>{message}</span>
      </div>
    {/if}

    <Button type="button" class="h-10 w-full" disabled={!canConnect} onclick={connectHost}>
      {connectState === "connecting" ? "connecting…" : "connect host"}
    </Button>
  </div>
</section>
