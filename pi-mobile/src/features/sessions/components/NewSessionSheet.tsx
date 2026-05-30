import { createEffect, createResource, createSignal, For, Show, type JSX } from "solid-js";
import { ChevronLeft, Folder, GitBranch, Plus } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TextField, TextFieldInput, TextFieldLabel } from "@/components/ui/text-field";
import { useKeyboardInset } from "@/lib/keyboard";
import { listGitBranches, type GitBranchInfo, type GitBranchesResult } from "@/lib/api";
import { getBridgeUrl } from "@/lib/settings";
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

function branchLabel(branch: GitBranchInfo): string {
  return branch.kind === "remote" ? `${branch.name} (remote)` : branch.name;
}

export default function NewSessionSheet(props: Props) {
  const [cwd, setCwd] = createSignal<string>();
  const [title, setTitle] = createSignal("");
  const [branch, setBranch] = createSignal<string>();
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [titleTouched, setTitleTouched] = createSignal(false);
  const keyboardInset = useKeyboardInset();

  const [gitInfo] = createResource<GitBranchesResult, string>(
    () => cwd() ?? "",
    async (c) => {
      if (!c) return { isRepo: false, branches: [] };
      const baseUrl = await getBridgeUrl();
      return listGitBranches(baseUrl, c);
    },
  );

  createEffect(() => {
    const info = gitInfo();
    if (!info?.isRepo) {
      setBranch(undefined);
      return;
    }
    setBranch((current) => {
      if (current && info.branches.some((b) => b.name === current)) return current;
      return info.current;
    });
  });

  const effectiveTitle = () => {
    const t = title().trim();
    if (t.length > 0) return t;
    const c = cwd();
    return c ? basename(c) : "";
  };

  const canCreate = () => {
    const info = gitInfo();
    return !!cwd() && !props.creating && (!info?.isRepo || !!branch());
  };

  function handleCreate() {
    const c = cwd();
    if (!c) return;
    const info = gitInfo();
    props.onCreate({
      cwd: c,
      title: effectiveTitle(),
      branch: info?.isRepo ? branch() : undefined,
    });
  }

  function handleOpenChange(open: boolean) {
    if (!open) props.onCancel();
  }

  return (
    <Sheet open={props.open} onOpenChange={handleOpenChange}>
      <SheetContent
        position="bottom"
        class="flex flex-col !max-h-[92dvh] !overflow-hidden gap-0 rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none"
        style={{
          "padding-bottom": `calc(env(safe-area-inset-bottom) + ${keyboardInset()}px + 0.5rem)`,
        }}
      >
        <SheetHeader class="hairline-b flex-row items-center gap-1 space-y-0 px-2 py-2 pr-12 text-left">
          <Show when={pickerOpen()} fallback={<div class="h-9 w-9" />}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setPickerOpen(false)}
              aria-label="Back"
              class="rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] hover:bg-transparent active:bg-[color:var(--color-surface)]"
            >
              <ChevronLeft size={16} />
            </Button>
          </Show>
          <SheetTitle class="min-w-0 flex-1 px-1 text-[13px] font-medium">
            {pickerOpen() ? "choose directory" : "new session"}
          </SheetTitle>
        </SheetHeader>

        <Show
          when={pickerOpen()}
          fallback={
            <>
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

                <BranchPicker
                  info={gitInfo()}
                  value={branch()}
                  onChange={setBranch}
                />
              </div>

              <div class="px-3 pt-2">
                <Button
                  type="button"
                  variant="default"
                  size="default"
                  onClick={handleCreate}
                  disabled={!canCreate()}
                  class="w-full bg-[color:var(--color-accent)] text-[color:var(--color-bg)] hover:bg-[color:var(--color-accent)] active:opacity-80"
                >
                  <Plus size={14} strokeWidth={2.5} />
                  {props.creating ? "creating…" : "create session"}
                </Button>
              </div>
            </>
          }
        >
          <CwdPicker
            initial={cwd()}
            onSelect={(p) => {
              setCwd(p);
              setPickerOpen(false);
            }}
          />
        </Show>
      </SheetContent>
    </Sheet>
  );
}

function BranchPicker(props: {
  info: GitBranchesResult | undefined;
  value: string | undefined;
  onChange: (branch: string) => void;
}) {
  const branchInfo = () => {
    const info = props.info;
    return info?.isRepo && info.branches.length > 0 ? info : null;
  };

  return (
    <Show when={branchInfo()}>
      {(info) => (
        <Field label="branch">
          <div class="space-y-1.5">
            <div class="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[12.5px]">
              <GitBranch size={12} class="shrink-0 text-[color:var(--color-fg-muted)]" />
              <span class="min-w-0 flex-1 truncate">{props.value ?? "choose a branch"}</span>
            </div>
            <div class="max-h-40 overflow-y-auto rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
              <For each={info().branches}>
                {(b) => (
                  <button
                    type="button"
                    onClick={() => props.onChange(b.name)}
                    class="hairline-b flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] active:bg-[color:var(--color-surface-2)]"
                  >
                    <span class="min-w-0 flex-1 truncate">{branchLabel(b)}</span>
                    <Show when={b.kind === "local" && b.current}>
                      <span class="text-[11px] text-[color:var(--color-fg-faint)]">current</span>
                    </Show>
                    <Show when={props.value === b.name}>
                      <span class="text-[color:var(--color-accent)]">✓</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <p class="px-1 text-[11px] leading-4 text-[color:var(--color-fg-faint)]">
              A per-session branch and git worktree will be created from this branch.
            </p>
          </div>
        </Field>
      )}
    </Show>
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
