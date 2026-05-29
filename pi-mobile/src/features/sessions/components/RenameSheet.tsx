import { createSignal, createEffect, on, Show } from "solid-js";
import { Check } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TextField, TextFieldInput } from "@/components/ui/text-field";
import { useKeyboardInset } from "@/lib/keyboard";

export default function RenameSheet(props: {
  open: boolean;
  initialTitle: string;
  saving?: boolean;
  onCancel: () => void;
  onSave: (newTitle: string) => void;
}) {
  const [value, setValue] = createSignal("");
  const keyboardInset = useKeyboardInset();

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) setValue(props.initialTitle);
      },
    ),
  );

  function commit() {
    const v = value().trim();
    if (v.length === 0 || props.saving) return;
    props.onSave(v);
  }

  function handleOpenChange(open: boolean) {
    if (!open) props.onCancel();
  }

  return (
    <Show when={props.open}>
      <Sheet open onOpenChange={handleOpenChange}>
        <SheetContent
          position="bottom"
          class="flex flex-col !overflow-hidden gap-0 rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none"
          style={{
            "padding-bottom": `calc(env(safe-area-inset-bottom) + ${keyboardInset()}px + 0.5rem)`,
          }}
        >
          <SheetHeader class="hairline-b space-y-0 px-3 py-3 pr-12 text-left">
            <SheetTitle class="min-w-0 flex-1 px-1 text-[13px] font-medium">
              Rename session
            </SheetTitle>
          </SheetHeader>

          <div class="px-3 pt-3 pb-2">
            <TextField>
              <TextFieldInput
                autofocus
                type="text"
                value={value()}
                onInput={(e) => setValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                }}
                placeholder="session title"
                class="text-[13px]"
              />
            </TextField>
          </div>

          <div class="flex gap-2 px-3 pb-2 pt-1">
            <Button type="button" variant="outline" onClick={props.onCancel} class="flex-1">
              cancel
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={commit}
              disabled={
                props.saving ||
                value().trim().length === 0 ||
                value().trim() === props.initialTitle
              }
              class="flex-1 bg-[color:var(--color-fg)] text-[color:var(--color-bg)] hover:bg-[color:var(--color-fg)] active:opacity-80"
            >
              <Check size={12} />
              {props.saving ? "saving…" : "save"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </Show>
  );
}
