<script lang="ts">
  import { onMount } from "svelte";
  import { Check, Loader2, Star, Trash2, X } from "@lucide/svelte";
  import { Effect } from "effect";
  import type { HostProfile } from "@/features/hosts/host-registry.state.svelte";
  import { hostRegistryState } from "@/features/hosts/host-registry.state.svelte";
  import { healthcheckHost } from "@/features/settings/api";
  import HostIssuePanel from "@/shared/components/HostIssuePanel.svelte";
  import { reachabilityIssue, type HostIssue } from "@/shared/lib/host-issues";
  import { Button } from "@/shared/ui/button";

  type HostStatus = "idle" | "checking" | "online" | "offline";

  let { host }: { host: HostProfile } = $props();

  let status = $state<HostStatus>("idle");
  let issue = $state<HostIssue | null>(null);

  const isDefault = $derived(hostRegistryState.defaultHostId === host.id);
  const canRemove = $derived(hostRegistryState.hosts.length > 1);

  onMount(() => {
    void refresh();
  });

  async function refresh(): Promise<void> {
    status = "checking";
    issue = null;
    const reachability = await Effect.runPromise(healthcheckHost(host.url));
    status = reachability === "healthy" ? "online" : "offline";
    issue = reachability === "healthy" ? null : reachabilityIssue(reachability, { url: host.url });
  }

  async function removeHost(): Promise<void> {
    if (!canRemove) return;
    await hostRegistryState.removeHost(host.id);
  }
</script>

<section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <div class="mb-3 flex items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <h2 class="type-title truncate font-medium text-[color:var(--color-fg)]">{host.name}</h2>
        {#if isDefault}
          <span class="type-label uppercase tracking-[0.08em] rounded-full border border-[color:var(--color-border)] px-2 py-0.5 text-[color:var(--color-fg-faint)]">default</span>
        {/if}
      </div>
      <p class="type-copy mt-1 break-all text-[color:var(--color-fg-muted)]">{host.url}</p>
    </div>

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
  </div>

  {#if status === "offline" && issue}
    <HostIssuePanel issue={issue} compact class="mb-3" />
  {/if}

  <div class="flex gap-2">
    <Button
      type="button"
      variant="outline"
      class="h-10 flex-1"
      disabled={status === "checking"}
      onclick={() => void refresh()}
    >
      {status === "checking" ? "checking…" : "check"}
    </Button>
    {#if !isDefault}
      <Button type="button" variant="outline" class="h-10 flex-1" onclick={() => hostRegistryState.setDefaultHost(host.id)}>
        <Star class="size-3.5" /> default
      </Button>
    {/if}
    <Button type="button" variant="outline" size="icon" disabled={!canRemove} onclick={() => void removeHost()} aria-label="Remove host" title="Remove host">
      <Trash2 class="size-3.5" />
    </Button>
  </div>
</section>
