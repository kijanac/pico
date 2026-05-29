import { Show, type JSX } from "solid-js";
import { ChevronLeft } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useKeyboardInset } from "@/lib/keyboard";
import type { AgentActionView } from "./types";

const titles: Record<AgentActionView, string> = {
  menu: "agent",
  models: "model",
  compact: "compact context",
  settings: "session settings",
  tree: "tree",
  auth: "provider sign-in",
  info: "session info",
};

export default function AgentActionSheet(props: {
  view: AgentActionView;
  error: string | null;
  onBack: () => void;
  onClose: () => void;
  children: JSX.Element;
}) {
  const keyboardInset = useKeyboardInset();

  function handleOpenChange(open: boolean) {
    if (!open) props.onClose();
  }

  return (
    <Sheet open onOpenChange={handleOpenChange}>
      <SheetContent
        position="bottom"
        class="flex flex-col !max-h-[86dvh] !overflow-hidden gap-0 rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none"
        style={{
          "padding-bottom": `calc(env(safe-area-inset-bottom) + ${keyboardInset()}px + 0.5rem)`,
        }}
      >
        <SheetHeader class="hairline-b flex-row items-center gap-1 space-y-0 px-2 py-2 pr-12 text-left">
          <Show when={props.view !== "menu"} fallback={<div class="h-9 w-9" />}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={props.onBack}
              aria-label="Back"
              class="rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] hover:bg-transparent active:bg-[color:var(--color-surface)]"
            >
              <ChevronLeft size={16} />
            </Button>
          </Show>
          <SheetTitle class="min-w-0 flex-1 px-1 text-[13px] font-medium">
            {titles[props.view]}
          </SheetTitle>
        </SheetHeader>

        <Show when={props.error}>
          <div class="mx-3 mt-3 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[11px] text-[color:var(--color-danger)]">
            {props.error}
          </div>
        </Show>

        {props.children}
      </SheetContent>
    </Sheet>
  );
}
