import { Show, type JSX } from "solid-js";
import { Pencil, Archive, Trash2, X, ArchiveRestore } from "lucide-solid";
import type { SessionMeta } from "@pi-mobile/protocol";

/**
 * Per-session action menu, rendered as a bottom sheet over a dimmed
 * backdrop. Opened by long-pressing a row in the sessions list.
 *
 * Three actions:
 *   Rename  — opens RenameSheet (caller handles the transition)
 *   Archive — soft-hide via PATCH archived. Pre-archived sessions
 *             show "Restore" instead.
 *   Delete  — destructive; hard delete via DELETE.
 *
 * The caller owns the API calls; this component only emits intents.
 */
export default function SessionActions(props: {
  session: SessionMeta | null;
  onRename: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Show when={props.session}>
      {(s) => (
        <div
          class="fixed inset-0 z-40 bg-[color:var(--color-bg)]/60 backdrop-blur-sm"
          onClick={props.onClose}
        >
          <div
            class="absolute inset-x-0 bottom-0 flex flex-col rounded-t-[12px] border-t border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]"
            style={{
              "padding-bottom":
                "calc(env(safe-area-inset-bottom) + 0.5rem)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* drag handle */}
            <div class="flex justify-center py-2">
              <div class="h-1 w-9 rounded-full bg-[color:var(--color-border-strong)]" />
            </div>

            {/* header */}
            <div class="hairline-b flex items-center justify-between px-3 pb-2">
              <span class="min-w-0 flex-1 truncate text-[13px] font-medium">
                {s().title}
              </span>
              <button
                type="button"
                onClick={props.onClose}
                class="ml-2 flex h-8 w-8 items-center justify-center text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            {/* actions */}
            <button
              type="button"
              onClick={props.onRename}
              class="hairline-b flex items-center gap-3 px-3 py-3 text-left active:bg-[color:var(--color-surface)]"
            >
              <Pencil size={14} class="text-[color:var(--color-fg-muted)]" />
              <span class="text-[13px]">Rename</span>
            </button>

            <button
              type="button"
              onClick={props.onToggleArchive}
              class="hairline-b flex items-center gap-3 px-3 py-3 text-left active:bg-[color:var(--color-surface)]"
            >
              <Show
                when={s().archived}
                fallback={
                  <>
                    <Archive
                      size={14}
                      class="text-[color:var(--color-fg-muted)]"
                    />
                    <span class="text-[13px]">Archive</span>
                  </>
                }
              >
                <ArchiveRestore
                  size={14}
                  class="text-[color:var(--color-fg-muted)]"
                />
                <span class="text-[13px]">Restore from archive</span>
              </Show>
            </button>

            <button
              type="button"
              onClick={props.onDelete}
              class="flex items-center gap-3 px-3 py-3 text-left text-[color:var(--color-danger)] active:bg-[color:var(--color-surface)]"
            >
              <Trash2 size={14} />
              <span class="text-[13px]">Delete</span>
            </button>
          </div>
        </div>
      )}
    </Show>
  );
}
