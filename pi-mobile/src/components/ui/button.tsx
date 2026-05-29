import type { ComponentProps } from "solid-js";
import { splitProps } from "solid-js";
import { Root as ButtonPrimitive } from "@kobalte/core/button";
import type { VariantProps } from "cva";

import { cva } from "@/lib/cva";

const buttonVariants = cva({
  base: [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium outline-none transition-[opacity,transform,background-color,border-color,color] duration-100",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "focus-visible:border-[color:var(--color-border-strong)] focus-visible:outline-none",
  ],

  variants: {
    variant: {
      accent:
        "rounded-[var(--radius-md)] bg-[color:var(--color-accent)] text-[color:var(--color-bg)] active:opacity-80",
      foreground:
        "rounded-[var(--radius-md)] bg-[color:var(--color-fg)] text-[color:var(--color-bg)] active:opacity-80",
      outline:
        "rounded-[var(--radius-md)] border border-[color:var(--color-border)] text-[color:var(--color-fg)] active:bg-[color:var(--color-surface)]",
      ghost:
        "rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)] active:text-[color:var(--color-fg)]",
      danger:
        "rounded-[var(--radius-md)] border border-[color:var(--color-danger)]/50 text-[color:var(--color-danger)] active:bg-[color:var(--color-surface)]",
      plain:
        "text-[color:var(--color-fg-muted)] active:text-[color:var(--color-fg)]",
    },
    size: {
      default: "h-10 px-3 text-[12px]",
      sm: "h-8 px-2.5 text-[11.5px]",
      lg: "h-11 px-4 text-[13px]",
      icon: "h-9 w-9",
      "icon-sm": "h-8 w-8",
      "icon-lg": "h-10 w-10",
    },
  },
  defaultVariants: {
    variant: "ghost",
    size: "default",
  },
});

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>;

export const Button = (props: ButtonProps) => {
  const [, rest] = splitProps(props, [
    "class",
    "variant",
    "size",
  ]);

  return (
    <ButtonPrimitive
      data-slot="button"
      class={buttonVariants({
        variant: props.variant,
        size: props.size,
        class: props.class,
      })}
      {...rest}
    />
  );
};
