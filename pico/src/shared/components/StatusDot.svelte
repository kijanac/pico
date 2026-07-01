<script lang="ts">
  type DotTone = "muted" | "accent" | "warn" | "danger";

  let {
    tone = "muted",
    active = false,
    label,
    size = 6,
    class: className = "",
  }: {
    tone?: DotTone;
    active?: boolean;
    label?: string;
    size?: number;
    class?: string;
  } = $props();

  const color = $derived.by(() => {
    switch (tone) {
      case "accent":
        return "var(--color-accent)";
      case "warn":
        return "var(--color-warn)";
      case "danger":
        return "var(--color-danger)";
      default:
        return "var(--color-fg-faint)";
    }
  });
</script>

<span
  class={`inline-block shrink-0 rounded-full ${active ? "pulse-accent" : ""} ${className}`}
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:background={color}
  style:box-shadow={active ? "0 0 0 3px var(--color-accent-dim)" : "none"}
  aria-label={label}
></span>
