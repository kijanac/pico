import { Show, type JSX } from "solid-js";
import { Pencil, Archive, Trash2, ArchiveRestore } from "lucide-solid";
import type { SessionMeta } from "@pi-mobile/protocol";
import BottomSheet from "~/components/BottomSheet";
import { Button } from "~/components/ui/button";

/** Per-session action menu opened by long-pressing a row in the sessions list. */
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
        <BottomSheet open title={<span class="truncate">{s().title}</span>} onClose={props.onClose}>
          <Button
            type="button"
            variant="plain"
            onClick={props.onRename}
            class="hairline-b h-auto w-full justify-start gap-3 px-3 py-3 text-left text-[color:var(--color-fg)] active:bg-[color:var(--color-surface)]"
          >
            <Pencil size={14} class="text-[color:var(--color-fg-muted)]" />
            <span class="text-[13px]">Rename</span>
          </Button>

          <Button
            type="button"
            variant="plain"
            onClick={props.onToggleArchive}
            class="hairline-b h-auto w-full justify-start gap-3 px-3 py-3 text-left text-[color:var(--color-fg)] active:bg-[color:var(--color-surface)]"
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
            variant="plain"
            onClick={props.onDelete}
            class="h-auto w-full justify-start gap-3 px-3 py-3 text-left text-[color:var(--color-danger)] active:bg-[color:var(--color-surface)]"
          >
            <Trash2 size={14} />
            <span class="text-[13px]">Delete</span>
          </Button>
        </BottomSheet>
      )}
    </Show>
  );
}
