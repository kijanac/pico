<script lang="ts">
  import { onMount } from "svelte";
  import { Check, Loader2, X } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { healthcheckBridgeUrl } from "@/features/settings/api";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import { Button } from "@/shared/ui/button";

  type Status = "idle" | "checking" | "online" | "offline";

  let status = $state<Status>("idle");

  onMount(() => {
    if (settingsState.bridgeUrlConfigured) void checkBridge();
  });

  async function checkBridge(): Promise<void> {
    if (!settingsState.bridgeUrlConfigured || status === "checking") return;
    status = "checking";
    status = (await healthcheckBridgeUrl(settingsState.bridgeUrl)) ? "online" : "offline";
  }
</script>

<section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <div class="mb-3 flex items-start justify-between gap-3">
    <div>
      <h2 class="type-title font-medium text-[color:var(--color-fg)]">bridge</h2>
      {#if settingsState.bridgeUrlConfigured}
        <p class="type-copy mt-1 break-all text-[color:var(--color-fg-muted)]">
          {settingsState.bridgeUrl}
        </p>
      {:else}
        <p class="type-copy mt-1 text-[color:var(--color-fg-muted)]">
          no bridge connected yet.
        </p>
      {/if}
    </div>

    {#if settingsState.bridgeUrlConfigured}
      <div class="type-label uppercase tracking-[0.08em] flex shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-2 py-1 text-[color:var(--color-fg-muted)]">
        {#if status === "checking"}
          <Loader2 class="size-3 animate-spin" /> checking
        {:else if status === "online"}
          <Check class="size-3 text-[color:var(--color-accent)]" /> online
        {:else if status === "offline"}
          <X class="size-3 text-[color:var(--color-danger)]" /> offline
        {:else}
          not checked
        {/if}
      </div>
    {/if}
  </div>

  {#if settingsState.bridgeUrlConfigured}
    <div class="flex gap-2">
      <Button type="button" variant="outline" class="h-10 flex-1" disabled={status === "checking"} onclick={checkBridge}>
        {status === "checking" ? "checking…" : "check"}
      </Button>
      <Button type="button" class="h-10 flex-1" onclick={() => navigateTo(routePaths.onboarding)}>
        replace
      </Button>
    </div>
  {:else}
    <Button type="button" class="h-10 w-full" onclick={() => navigateTo(routePaths.onboarding)}>
      set up bridge
    </Button>
  {/if}
</section>
