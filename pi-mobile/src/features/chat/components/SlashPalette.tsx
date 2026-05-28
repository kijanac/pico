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
import { Search, Hash, FileText, Sparkles } from "lucide-solid";
import BottomSheet from "~/components/BottomSheet";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
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
  sessionId: string;
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

  const [loadToken, setLoadToken] = createSignal(0);

  // Fetch commands when the sheet opens. Bump a token on every open so
  // prompts/skills added outside the app are picked up next time.
  const [commands] = createResource<Commands | null, number>(
    loadToken,
    async (token) => {
      if (token === 0) return null;
      const baseUrl = await getBridgeUrl();
      return listCommands(baseUrl, props.sessionId);
    },
  );

  createEffect(() => {
    if (!props.open) return;
    setQuery("");
    setLoadToken((n) => n + 1);
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
      <BottomSheet open title="commands" onClose={props.onCancel} maxHeightClass="max-h-[80dvh]">
        <div class="hairline-b px-2 pb-2">
          <div class="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 py-2 focus-within:border-[color:var(--color-border-strong)]">
            <Search size={12} class="shrink-0 text-[color:var(--color-fg-muted)]" />
            <TextField>
              <TextFieldInput
                autofocus
                type="text"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder="search…"
                class="border-0 bg-transparent px-0 py-0 focus:border-0 focus-visible:border-0"
              />
            </TextField>
          </div>
        </div>

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
      </BottomSheet>
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
