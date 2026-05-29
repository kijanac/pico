import { createSignal, Show, type JSX } from "solid-js";
import { Folder, GitBranch, Plus } from "lucide-solid";
import BottomSheet from "@/components/BottomSheet";
import { Button } from "@/components/ui/button";
import { TextField, TextFieldInput, TextFieldLabel } from "@/components/ui/text-field";
import CwdPicker from "./CwdPicker";

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreate: (opts: { cwd: string; title: string; branch?: string }) => void;
  creating?: boolean;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export default function NewSessionSheet(props: Props) {
  const [cwd, setCwd] = createSignal<string | null>(null);
  const [title, setTitle] = createSignal("");
  const [branch, setBranch] = createSignal("");
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [titleTouched, setTitleTouched] = createSignal(false);

  const effectiveTitle = () => {
    const t = title().trim();
    if (t.length > 0) return t;
    const c = cwd();
    return c ? basename(c) : "";
  };

  const canCreate = () => cwd() !== null && cwd()!.length > 0 && !props.creating;

  function handleCreate() {
    const c = cwd();
    if (!c) return;
    props.onCreate({
      cwd: c,
      title: effectiveTitle(),
      branch: branch().trim() || undefined,
    });
  }

  return (
    <>
      <Show when={props.open}>
        <BottomSheet open title="new session" onClose={props.onCancel} maxHeightClass="max-h-[92dvh]">
        <div class="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
          <Field label="cwd">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              class="flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2.5 text-left active:bg-[color:var(--color-surface-2)]"
            >
              <Folder size={13} class="shrink-0 text-[color:var(--color-fg-muted)]" />
              <Show
                when={cwd()}
                fallback={
                  <span class="text-[12.5px] text-[color:var(--color-fg-faint)]">
                    choose a directory…
                  </span>
                }
              >
                <span class="min-w-0 flex-1 truncate text-[12.5px]">{cwd()}</span>
              </Show>
            </button>
          </Field>

          <TextField>
            <TextFieldLabel>title</TextFieldLabel>
            <TextFieldInput
              type="text"
              value={title()}
              onInput={(e) => {
                setTitle(e.currentTarget.value);
                if (!titleTouched()) setTitleTouched(true);
              }}
              placeholder={cwd() ? basename(cwd()!) : "session title"}
              class="py-2.5"
            />
          </TextField>

          <Field label="branch (optional)">
            <div class="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-0.5 focus-within:border-[color:var(--color-border-strong)]">
              <GitBranch size={12} class="shrink-0 text-[color:var(--color-fg-muted)]" />
              <TextFieldInput
                type="text"
                value={branch()}
                onInput={(e) => setBranch(e.currentTarget.value)}
                placeholder="main"
                class="border-0 bg-transparent px-0 py-2 focus:border-0 focus-visible:border-0"
              />
            </div>
          </Field>
        </div>

        <div class="px-3 pt-2">
          <Button
            type="button"
            variant="accent"
            size="default"
            onClick={handleCreate}
            disabled={!canCreate()}
            class="w-full"
          >
            <Plus size={14} strokeWidth={2.5} />
            {props.creating ? "creating…" : "create session"}
          </Button>
        </div>

        </BottomSheet>
      </Show>

      <Show when={props.open && pickerOpen()}>
        <CwdPicker
          initial={cwd() ?? undefined}
          onSelect={(p) => {
            setCwd(p);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      </Show>
    </>
  );
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label class="block">
      <div class="label mb-1.5">{props.label}</div>
      {props.children}
    </label>
  );
}
