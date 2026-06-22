import { untrack } from "svelte";
import type { Commands } from "@pico/protocol";
import { listSessionCommands } from "@/features/chat/api";
import { runHost } from "@/shared/lib/rpc-client";

export type CommandEntry = Commands["builtins"][number] | Commands["prompts"][number] | Commands["skills"][number];

export interface SlashCommandCompletion {
  value: string;
  cursor: number;
}

export interface SlashCommandsState {
  readonly query: string | null;
  readonly matches: readonly CommandEntry[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedIndex: number;
  select(index: number): void;
  complete(entry: CommandEntry): SlashCommandCompletion;
  handleKey(event: KeyboardEvent): SlashCommandCompletion | null;
}

export function createSlashCommandsState(
  sessionId: () => string,
  text: () => string,
  cursor: () => number,
): SlashCommandsState {
  let commands = $state<Commands | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let attemptedFor = $state<string | null>(null);
  let requestId = 0;
  let selectedIndex = $state(0);

  const query = $derived(slashCommandQuery(text(), cursor()));
  const matches = $derived(matchCommands(commands, query ?? ""));

  $effect(() => {
    if (query === null || loading || attemptedFor === sessionId()) return;
    untrack(() => void load());
  });

  $effect(() => {
    query;
    matches.length;
    selectedIndex = 0;
  });

  async function load(): Promise<void> {
    const currentSession = sessionId();
    const currentRequest = ++requestId;
    loading = true;
    error = null;

    try {
      const next = await runHost(listSessionCommands(currentSession));
      if (currentRequest !== requestId) return;
      commands = next;
    } catch (caught) {
      if (currentRequest !== requestId) return;
      error = String(caught);
    } finally {
      if (currentRequest === requestId) {
        attemptedFor = currentSession;
        loading = false;
      }
    }
  }

  function select(index: number): void {
    selectedIndex = index;
  }

  function complete(entry: CommandEntry): SlashCommandCompletion {
    const source = text();
    const commandEnd = source.search(/\s/);
    const replaceEnd = commandEnd === -1 ? source.length : commandEnd;
    const rest = source.slice(replaceEnd).trimStart();
    const inserted = `/${entry.name} `;
    return {
      value: `${inserted}${rest}`,
      cursor: inserted.length,
    };
  }

  function handleKey(event: KeyboardEvent): SlashCommandCompletion | null {
    if (query === null || matches.length === 0) return null;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % matches.length;
      return null;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
      return null;
    }

    if (event.key !== "Enter" && event.key !== "Tab") return null;

    event.preventDefault();
    return complete(matches[selectedIndex] ?? matches[0]);
  }

  return {
    get query() {
      return query;
    },
    get matches() {
      return matches;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get selectedIndex() {
      return selectedIndex;
    },
    select,
    complete,
    handleKey,
  };
}

function slashCommandQuery(text: string, cursor: number): string | null {
  if (!text.startsWith("/") || cursor === 0) return null;

  const end = text.search(/\s/);
  const commandEnd = end === -1 ? text.length : end;
  if (cursor > commandEnd) return null;

  return text.slice(1, cursor).toLowerCase();
}

function matchCommands(commands: Commands | null, query: string): CommandEntry[] {
  if (!commands) return [];

  const entries = [...commands.builtins, ...commands.prompts, ...commands.skills];
  if (query.length === 0) return entries;

  return entries.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(query));
}
