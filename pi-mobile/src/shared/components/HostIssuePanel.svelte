<script lang="ts">
  import type { Snippet } from "svelte";
  import { AlertTriangle, KeyRound, PlugZap, ShieldAlert, WifiOff } from "@lucide/svelte";
  import type { HostIssue } from "@/shared/lib/host-issues";

  let {
    issue,
    compact = false,
    class: className = "",
    action,
  }: {
    issue: HostIssue;
    compact?: boolean;
    class?: string;
    action?: Snippet;
  } = $props();

  const toneClass = $derived(
    issue.kind === "provider-auth-missing"
      ? "border-[color:var(--color-warning,#d97706)]/35 bg-[color:var(--color-warning,#d97706)]/8"
      : "border-[color:var(--color-danger)]/35 bg-[color:var(--color-danger)]/8",
  );
</script>

<div class={`rounded-[var(--radius-md)] border p-3 text-left ${toneClass} ${className}`}>
  <div class="flex items-start gap-2">
    <span class="mt-0.5 shrink-0 text-[color:var(--color-fg-muted)]">
      {#if issue.kind === "host-unreachable"}
        <PlugZap class="size-4" />
      {:else if issue.kind === "tailscale-not-connected"}
        <WifiOff class="size-4" />
      {:else if issue.kind === "pairing-token-invalid"}
        <KeyRound class="size-4" />
      {:else if issue.kind === "host-claimed" || issue.kind === "host-unclaimed"}
        <ShieldAlert class="size-4" />
      {:else}
        <AlertTriangle class="size-4" />
      {/if}
    </span>
    <div class="min-w-0 flex-1">
      <p class="type-copy font-medium text-[color:var(--color-fg)]">{issue.title}</p>
      <p class="type-meta mt-1 text-[color:var(--color-fg-muted)]">{issue.message}</p>
      {#if !compact && issue.steps.length > 0}
        <ul class="type-meta mt-2 list-disc space-y-1 pl-4 text-[color:var(--color-fg-muted)]">
          {#each issue.steps as step}
            <li>{step}</li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if action}
      <div class="shrink-0 self-start">{@render action()}</div>
    {/if}
  </div>
</div>
