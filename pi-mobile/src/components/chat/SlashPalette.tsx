import {
  Show,
  For,
  createResource,
  createSignal,
  createMemo,
  createEffect,
  onCleanup,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Search, X, Hash, FileText, Sparkles } from "lucide-solid";
import { listCommands, type CommandEntry, type Commands } from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";

/**
 * Slash command palette.
 *
 * Lists every slash command pi knows about: built-ins (curated server-side
 * from pi 0.65+ docs), prompt templates (from ~/.pi/agent/prompts/), and
 * skills (from ~/.pi/agent/skills/<name>/SKILL.md). Picks insert
 *
 *   /name<space>           for builtins and templates with args
 *   /name                  for argument-less builtins
 *   /skill:name<space>     for skills
 *
 * into the caller-provided callback. Trailing space is added when the
 * command takes args so the user can start typing immediately.
 *
 * Substring search, mobile-friendly bottom sheet, no keyboard nav.
 * Mobile users tap; that's the model we're optimizing for.
 */
interface Props {
  open: boolean;
  onCancel: () => void;
  onPick: (text: string) => void;
}

function commandLabel(c: CommandEntry): string {
  return c.kind === "skill" ? c.name : `/${c.name}`;
}

/** Returns the text to insert into the input field for this command. */
function commandInsertion(c: CommandEntry): string {
  if (c.kind === "skill") {
    // Skills are invoked as /skill:name and almost always take args.
    return `/${c.name} `;
  }
  const suffix = c.takesArgs ? " " : "";
  return `/${c.name}${suffix}`;
}

export default function SlashPalette(props: Props): JSX.Element {
  const [query, setQuery] = createSignal("");

  // Fetch commands when the sheet first opens. Re-fetch when re-opened
  // in case the user added new prompts/skills externally.
  const [commands, { refetch }] = createResource<Commands | null, boolean>(
    () => props.open,
    async (open) => {
      if (!open) return null;
      const baseUrl = await getBridgeUrl();
      return listCommands(baseUrl);
    },
  );

  // Refetch + clear query each time the sheet opens.
  createEffect(() => {
    if (props.open) {
      setQuery("");
      // Trigger re-fetch if we already have stale data
      if (commands()) void refetch();
    }
  });

  /* ── filter ──────────────────────────────────────────────────────── */
  const matches = (entries: CommandEntry[] | undefined): CommandEntry[] => {
    if (!entries) return [];
    const q = query().trim().toLowerCase();
    if (q.length === 0) return entries;
    return entries.filter((c) => {
      const hay = `${c.name} ${c.description}`.toLowerCase();
      return hay.includes(q);
    });
  };

  const builtins = createMemo(() => matches(commands()?.builtins));
  const prompts = createMemo(() => matches(commands()?.prompts));
  const skills = createMemo(() => matches(commands()?.skills));
  const total = () => builtins().length + prompts().length + skills().length;

  function pick(c: CommandEntry) {
    props.onPick(commandInsertion(c));
  }

  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-[100] bg-[color:var(--color-bg)]/60 backdrop-blur-sm"
          onPointerDown={(e) => {
            if (e.currentTarget === e.target) props.onCancel();
          }}
        >
        <div
          class="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-[12px] border-t border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]"
          style={{
            "padding-bottom": "calc(env(safe-area-inset-bottom) + 0.5rem)",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* drag handle */}
          <div class="flex justify-center py-2">
            <div class="h-1 w-9 rounded-full bg-[color:var(--color-border-strong)]" />
          </div>

          {/* header + search */}
          <div class="hairline-b px-2 pb-2">
            <div class="flex items-center justify-between pb-2">
              <span class="text-[13px] font-medium">commands</span>
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  props.onCancel();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  props.onCancel();
                }}
                class="flex h-10 w-10 items-center justify-center text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div class="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 py-2 focus-within:border-[color:var(--color-border-strong)]">
              <Search
                size={12}
                class="shrink-0 text-[color:var(--color-fg-muted)]"
              />
              <input
                autofocus
                type="text"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder="search…"
                class="w-full bg-transparent text-[12.5px] text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-faint)] focus:outline-none"
              />
            </div>
          </div>

          {/* list */}
          <div class="flex-1 overflow-y-auto">
            <Show when={commands.loading}>
              <div class="px-3 py-3 text-[12px] text-[color:var(--color-fg-faint)]">
                loading…
              </div>
            </Show>
            <Show when={commands.error}>
              <div class="px-3 py-3 text-[12px] text-[color:var(--color-danger)]">
                {String(commands.error)}
              </div>
            </Show>

            <Show
              when={commands() && total() > 0}
              fallback={
                <Show when={commands() && total() === 0}>
                  <div class="px-3 py-6 text-center text-[12px] text-[color:var(--color-fg-faint)]">
                    no matches
                  </div>
                </Show>
              }
            >
              <Section label="built-in" icon={<Hash size={11} />} entries={builtins()} onPick={pick} />
              <Section label="prompts" icon={<FileText size={11} />} entries={prompts()} onPick={pick} />
              <Section label="skills" icon={<Sparkles size={11} />} entries={skills()} onPick={pick} />
            </Show>
          </div>
        </div>
        </div>
      </Portal>
    </Show>
  );
}

/* ── primitives ──────────────────────────────────────────────────────── */

function Section(props: {
  label: string;
  icon: JSX.Element;
  entries: CommandEntry[];
  onPick: (c: CommandEntry) => void;
}): JSX.Element {
  return (
    <Show when={props.entries.length > 0}>
      <div class="sticky top-0 z-10 flex items-center gap-1.5 border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]/95 px-3 py-1 backdrop-blur-md">
        <span class="text-[color:var(--color-fg-faint)]">{props.icon}</span>
        <span class="label">{props.label}</span>
      </div>
      <For each={props.entries}>
        {(c) => (
          <button
            type="button"
            onClick={() => props.onPick(c)}
            class="hairline-b flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left active:bg-[color:var(--color-surface)]"
          >
            <span class="font-mono text-[12.5px] text-[color:var(--color-fg)]">
              {commandLabel(c)}
            </span>
            <span class="line-clamp-2 text-[11px] text-[color:var(--color-fg-muted)]">
              {c.description}
            </span>
          </button>
        )}
      </For>
    </Show>
  );
}
