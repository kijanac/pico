<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "@/shared/lib/utils.js";

  type ActionRowVariant = "list" | "card";
  type ActionRowAlign = "center" | "start";
  type ActionRowJustify = "start" | "between";

  type ActionRowProps = WithElementRef<HTMLButtonAttributes> & {
    variant?: ActionRowVariant;
    align?: ActionRowAlign;
    justify?: ActionRowJustify;
  };

  let {
    class: className,
    variant = "list",
    align = "center",
    justify = "start",
    ref = $bindable(null),
    type = "button",
    disabled,
    children,
    ...restProps
  }: ActionRowProps = $props();
</script>

<button
  bind:this={ref}
  {type}
  {disabled}
  class={cn(
    "flex w-full gap-2 text-left transition-colors outline-none disabled:pointer-events-none disabled:opacity-70 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]",
    variant === "card"
      ? "rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 active:bg-[color:var(--color-surface-2)]"
      : "hairline-b px-3 py-2.5 active:bg-[color:var(--color-surface)]",
    align === "start" ? "items-start" : "items-center",
    justify === "between" ? "justify-between" : "justify-start",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</button>
