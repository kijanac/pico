import { createSignal, createEffect, on, Show, type JSX } from "solid-js";
import { Check } from "lucide-solid";
import BottomSheet from "~/components/BottomSheet";
import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput } from "~/components/ui/text-field";

export default function RenameSheet(props: {
  open: boolean;
  initialTitle: string;
  saving?: boolean;
  onCancel: () => void;
  onSave: (newTitle: string) => void;
}): JSX.Element {
  const [value, setValue] = createSignal("");

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

  return (
    <Show when={props.open}>
      <BottomSheet open title="Rename session" onClose={props.onCancel}>
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
            variant="foreground"
            onClick={commit}
            disabled={
              props.saving ||
              value().trim().length === 0 ||
              value().trim() === props.initialTitle
            }
            class="flex-1"
          >
            <Check size={12} />
            {props.saving ? "saving…" : "save"}
          </Button>
        </div>
      </BottomSheet>
    </Show>
  );
}
