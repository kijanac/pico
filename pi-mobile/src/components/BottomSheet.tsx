import { Show, type JSX } from "solid-js";
import { ChevronLeft, X } from "lucide-solid";
import {
  Drawer,
  DrawerContent,
  DrawerLabel,
  DrawerPortal,
} from "~/components/ui/drawer";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";

export default function BottomSheet(props: {
  open: boolean;
  title?: JSX.Element;
  error?: string | null;
  maxHeightClass?: string;
  onOpenChange?: (open: boolean) => void;
  onClose: () => void;
  onBack?: () => void;
  children: JSX.Element;
  headerTrailing?: JSX.Element;
  contentClass?: string;
}): JSX.Element {
  const setOpen = (open: boolean) => {
    props.onOpenChange?.(open);
    if (!open) props.onClose();
  };

  return (
    <Drawer open={props.open} onOpenChange={setOpen} side="bottom">
      <DrawerPortal>
        <DrawerContent
          withHandle={false}
          class={cn(
            "z-[101] flex flex-col rounded-t-[12px] border-t border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] text-[color:var(--color-fg)] outline-none data-[transitioning]:duration-200 data-[transitioning]:ease-out",
            props.maxHeightClass ?? "max-h-[86dvh]",
            props.contentClass,
          )}
          style={{ "padding-bottom": "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
        >
          <div class="mt-2 h-1 w-10 shrink-0 self-center rounded-full bg-[color:var(--color-border-strong)]" />
          <Show when={props.title !== undefined || props.onBack !== undefined || props.headerTrailing !== undefined}>
            <div class="hairline-b flex items-center gap-1 px-2 pb-2 pt-1">
              <Show when={props.onBack} fallback={<div class="h-9 w-9" />}>
                {(onBack) => (
                  <Button type="button" variant="ghost" size="icon" onClick={onBack()} aria-label="Back">
                    <ChevronLeft size={16} />
                  </Button>
                )}
              </Show>
              <DrawerLabel class="min-w-0 flex-1 px-1 text-[13px] font-medium">
                {props.title}
              </DrawerLabel>
              <Show
                when={props.headerTrailing}
                fallback={
                  <Button type="button" variant="ghost" size="icon" onClick={props.onClose} aria-label="Close">
                    <X size={14} />
                  </Button>
                }
              >
                {(trailing) => trailing()}
              </Show>
            </div>
          </Show>

          <Show when={props.error}>
            <div class="mx-3 mt-3 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[11px] text-[color:var(--color-danger)]">
              {props.error}
            </div>
          </Show>

          {props.children}
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}
