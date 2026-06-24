<script lang="ts">
  import { onMount } from "svelte";
  import { Check, Loader2, X } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { hostStatusState } from "@/features/settings/host-status.state.svelte";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import HostIssuePanel from "@/shared/components/HostIssuePanel.svelte";
  import { Button } from "@/shared/ui/button";

  // Stale-guarded, silent refresh: shows the last-known status instantly and only
  // re-checks if it's gone stale — so it never flickers when re-entering settings.
  onMount(() => {
    if (settingsState.hostUrlConfigured) void hostStatusState.refresh();
  });
</script>

<section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <div class="mb-3 flex items-start justify-between gap-3">
    <div>
      <h2 class="type-title font-medium text-[color:var(--color-fg)]">Pico host</h2>
      {#if settingsState.hostUrlConfigured}
        <p class="type-copy mt-1 break-all text-[color:var(--color-fg-muted)]">
          {settingsState.hostUrl}
        </p>
      {:else}
        <p class="type-copy mt-1 text-[color:var(--color-fg-muted)]">
          no Pico host connected yet.
        </p>
      {/if}
    </div>

    {#if settingsState.hostUrlConfigured}
      <div class="type-label uppercase tracking-[0.08em] flex shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-2 py-1 text-[color:var(--color-fg-muted)]">
        {#if hostStatusState.status === "checking"}
          <Loader2 class="size-3 animate-spin" /> checking
        {:else if hostStatusState.status === "online"}
          <Check class="size-3 text-[color:var(--color-accent)]" /> online
        {:else if hostStatusState.status === "offline"}
          <X class="size-3 text-[color:var(--color-danger)]" /> offline
        {:else}
          not checked
        {/if}
      </div>
    {/if}
  </div>

  {#if settingsState.hostUrlConfigured}
    {#if hostStatusState.status === "offline" && hostStatusState.issue}
      <HostIssuePanel issue={hostStatusState.issue} compact class="mb-3" />
    {/if}

    <div class="flex gap-2">
      <Button
        type="button"
        variant="outline"
        class="h-10 flex-1"
        disabled={hostStatusState.status === "checking"}
        onclick={() => hostStatusState.refresh({ force: true, showProgress: true })}
      >
        {hostStatusState.status === "checking" ? "checking…" : "check"}
      </Button>
      <Button type="button" class="h-10 flex-1" onclick={() => navigateTo(routePaths.welcome)}>
        replace
      </Button>
    </div>
  {:else}
    <Button type="button" class="h-10 w-full" onclick={() => navigateTo(routePaths.welcome)}>
      set up Pico host
    </Button>
  {/if}
</section>
