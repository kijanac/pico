<script lang="ts">
  import { AlertCircle, AlertTriangle, XCircle } from "@lucide/svelte";

  let {
    stopReason,
    errorMessage,
  }: {
    stopReason: "error" | "aborted" | "length" | "stop" | "toolUse";
    errorMessage?: string;
  } = $props();

  const toneClass = $derived(
    stopReason === "error"
      ? "text-[color:var(--color-danger)]"
      : stopReason === "length"
        ? "text-[color:var(--color-warning,#d97706)]"
        : "text-[color:var(--color-fg-muted)]",
  );

  const label = $derived(
    stopReason === "error"
      ? "error"
      : stopReason === "length"
        ? "output truncated (max tokens reached)"
        : "interrupted",
  );
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
    {#if errorMessage}
      <div class="mt-0.5 break-words opacity-80">{errorMessage}</div>
    {/if}
  </div>
</div>
