<script lang="ts">
  import { onMount } from "svelte";
  import { Check, Loader2, X } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { connectAndClaimHost } from "@/features/onboarding/api";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import HostIssuePanel from "@/shared/components/HostIssuePanel.svelte";
  import { classifyHostIssue, hostIssueForCode, type HostIssue } from "@/shared/lib/host-issues";
  import { runAt } from "@/shared/lib/rpc-client";
  import { haptics } from "@/shared/mobile/haptics";
  import { Button } from "@/shared/ui/button";

  type ConnectState = "connecting" | "claimed" | "failed";

  let connectState = $state<ConnectState>("connecting");
  let message = $state("Preparing Pico host pairing…");
  let hostUrl = $state("");
  let issue = $state<HostIssue | null>(null);

  onMount(() => {
    void connectFromQuery();
  });

  async function connectFromQuery(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    hostUrl = params.get("url")?.trim() ?? "";
    const token = params.get("claim")?.trim() || params.get("token")?.trim() || undefined;

    issue = null;

    if (!hostUrl) {
      connectState = "failed";
      issue = hostIssueForCode("pairing_link_missing_url");
      message = issue.message;
      return;
    }

    try {
      if (!settingsState.loaded) await settingsState.load();
      message = `Checking ${hostUrl} and claiming owner identity…`;
      await runAt(hostUrl, connectAndClaimHost(hostUrl, token));

      connectState = "claimed";
      message = "Pico host connected. Opening sessions…";
      haptics.success();
      window.setTimeout(() => navigateTo(routePaths.sessions, "replace"), 800);
    } catch (error) {
      connectState = "failed";
      issue = classifyHostIssue(error, { url: hostUrl });
      message = issue.message;
    }
  }
</script>

<main class="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
  <div class="w-full max-w-sm rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
    {#if connectState === "connecting"}
      <Loader2 class="mx-auto mb-3 size-7 animate-spin text-[color:var(--color-accent)]" />
      <h1 class="type-title font-medium">pairing Pico host</h1>
    {:else if connectState === "claimed"}
      <Check class="mx-auto mb-3 size-7 text-[color:var(--color-accent)]" />
      <h1 class="type-title font-medium">connected</h1>
    {:else}
      <X class="mx-auto mb-3 size-7 text-[color:var(--color-danger)]" />
      <h1 class="type-title font-medium">pairing failed</h1>
    {/if}

    {#if hostUrl}
      <p class="type-meta mt-2 break-all text-[color:var(--color-fg-muted)]">{hostUrl}</p>
    {/if}
    {#if connectState === "failed" && issue}
      <HostIssuePanel issue={issue} class="mt-4" />
    {:else}
      <p class="type-copy mt-3 text-[color:var(--color-fg-muted)]">{message}</p>
    {/if}

    {#if connectState === "failed"}
      <div class="mt-4 flex gap-2">
        <Button type="button" variant="outline" class="h-10 flex-1" onclick={() => navigateTo(routePaths.welcome, "replace")}>setup</Button>
        <Button type="button" class="h-10 flex-1" onclick={connectFromQuery}>retry</Button>
      </div>
    {/if}
  </div>
</main>
