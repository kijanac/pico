<script lang="ts">
  import type { SessionMeta } from "@pico/protocol";

  let { status, size = 6, class: className = "" }: { status: SessionMeta["status"]; size?: number; class?: string } = $props();

  const color = $derived.by(() => {
    switch (status) {
      case "thinking":
      case "tool":
        return "var(--color-accent)";
      case "waiting":
        return "var(--color-warn)";
      case "error":
        return "var(--color-danger)";
      default:
        return "var(--color-fg-faint)";
    }
  });

  const active = $derived(status === "thinking" || status === "tool");
</script>

<span
  class={`inline-block shrink-0 rounded-full ${active ? "pulse-accent" : ""} ${className}`}
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:background={color}
  style:box-shadow={active ? "0 0 0 3px var(--color-accent-dim)" : "none"}
  aria-label={status}
></span>
