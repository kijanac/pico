import { Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { ChevronLeft, X } from "lucide-solid";
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
}): JSX.Element {
  return (
    <Portal>
      <div
        class="fixed inset-0 z-[100] bg-[color:var(--color-bg)]/60 backdrop-blur-sm"
        onPointerDown={(e) => {
          if (e.currentTarget === e.target) props.onClose();
        }}
      >
        <div
          class="absolute inset-x-0 bottom-0 flex max-h-[86dvh] flex-col rounded-t-[12px] border-t border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]"
          style={{ "padding-bottom": "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div class="flex justify-center py-2">
            <div class="h-1 w-9 rounded-full bg-[color:var(--color-border-strong)]" />
          </div>

          <div class="hairline-b flex items-center gap-1 px-2 pb-2">
            <Show when={props.view !== "menu"}>
              <button
                type="button"
                onClick={props.onBack}
                class="flex h-9 w-9 items-center justify-center text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
                aria-label="Back"
              >
                <ChevronLeft size={16} />
              </button>
            </Show>
            <div class="min-w-0 flex-1 px-1 text-[13px] font-medium">{titles[props.view]}</div>
            <button
              type="button"
              onClick={props.onClose}
              class="flex h-9 w-9 items-center justify-center text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          <Show when={props.error}>
            <div class="mx-3 mt-3 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[11px] text-[color:var(--color-danger)]">
              {props.error}
            </div>
          </Show>

          {props.children}
        </div>
      </div>
    </Portal>
  );
}
