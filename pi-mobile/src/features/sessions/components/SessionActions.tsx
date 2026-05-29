import { Show } from "solid-js";
import { Pencil, Archive, Trash2, ArchiveRestore } from "lucide-solid";
import type { SessionMeta } from "@pi-mobile/protocol";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export default function SessionActions(props: {
  session: SessionMeta | null;
  onRename: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  function handleOpenChange(open: boolean) {
    if (!open) props.onClose();
  }

  return (
    <Show when={props.session}>
      {(s) => (
        <Sheet open onOpenChange={handleOpenChange}>
          <SheetContent
            position="bottom"
            class="flex flex-col !overflow-hidden gap-0 rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none"
            style={{ "padding-bottom": "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
          >
          <SheetHeader class="hairline-b space-y-0 px-3 py-3 pr-12 text-left">
              <SheetTitle class="min-w-0 flex-1 truncate px-1 text-[13px] font-medium">
                {s().title}
              </SheetTitle>
          </SheetHeader>

            <Button
              type="button"
              variant="ghost"
              onClick={props.onRename}
              class="hairline-b h-auto w-full justify-start gap-3 rounded-none px-3 py-3 text-left text-[color:var(--color-fg)] hover:bg-transparent active:bg-[color:var(--color-surface)]"
            >
              <Pencil size={14} class="text-[color:var(--color-fg-muted)]" />
              <span class="text-[13px]">Rename</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={props.onToggleArchive}
              class="hairline-b h-auto w-full justify-start gap-3 rounded-none px-3 py-3 text-left text-[color:var(--color-fg)] hover:bg-transparent active:bg-[color:var(--color-surface)]"
            >
              <Show
                when={s().archived}
                fallback={
                  <>
                    <Archive size={14} class="text-[color:var(--color-fg-muted)]" />
                    <span class="text-[13px]">Archive</span>
                  </>
                }
              >
                <ArchiveRestore size={14} class="text-[color:var(--color-fg-muted)]" />
                <span class="text-[13px]">Restore from archive</span>
              </Show>
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={props.onDelete}
              class="h-auto w-full justify-start gap-3 rounded-none px-3 py-3 text-left text-[color:var(--color-danger)] hover:bg-transparent active:bg-[color:var(--color-surface)]"
            >
              <Trash2 size={14} />
              <span class="text-[13px]">Delete</span>
            </Button>
          </SheetContent>
        </Sheet>
      )}
    </Show>
  );
}
