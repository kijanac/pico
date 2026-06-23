<script lang="ts">
  import { AlertCircle, AlertTriangle, XCircle } from "@lucide/svelte";
  import type { HostErrorCode } from "@pico/protocol";
  import { hostIssueForCode } from "@/shared/lib/host-issues";

  let {
    stopReason,
    errorMessage,
    errorCode,
  }: {
    stopReason: "error" | "aborted" | "length" | "stop" | "toolUse";
    errorMessage?: string;
    errorCode?: HostErrorCode;
  } = $props();

  const hostIssue = $derived(errorCode ? hostIssueForCode(errorCode) : null);
  const providerAuthIssue = $derived(hostIssue?.kind === "provider-auth-missing" ? hostIssue : null);

  const toneClass = $derived(
    stopReason === "error"
      ? "text-[color:var(--color-danger)]"
      : stopReason === "length"
        ? "text-[color:var(--color-warning,#d97706)]"
        : "text-[color:var(--color-fg-muted)]",
  );

  const label = $derived(
    providerAuthIssue
      ? providerAuthIssue.title
      : stopReason === "error"
        ? "error"
        : stopReason === "length"
          ? "output truncated (max tokens reached)"
          : "interrupted",
  );

  const detail = $derived(providerAuthIssue ? providerAuthIssue.message : errorMessage);
</script>

<div class={`type-meta mt-1.5 flex items-start gap-1.5 ${toneClass}`}>
  <span class="mt-[2px] shrink-0">
    {#if stopReason === "error"}
      <XCircle class="size-3" />
    {:else if stopReason === "length"}
      <AlertTriangle class="size-3" />
    {:else}
      <AlertCircle class="size-3" />
    {/if}
  </span>
  <div class="min-w-0 flex-1">
    <div class="font-medium">{label}</div>
    {#if detail}
      <div class="mt-0.5 break-words opacity-80">{detail}</div>
    {/if}
  </div>
</div>
