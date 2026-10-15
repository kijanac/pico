import type { FsListing } from "@pico/protocol";
import { Effect, Fiber } from "effect";
import { listFiles } from "@/features/chat/api";
import { forkRpc } from "@/shared/lib/rpc-client";
import { shortFailureText } from "@/shared/lib/host-issues";

const RECENT_DIRECTORIES = 8;

export function useDirectory(initial: () => string | undefined, active: () => boolean) {
  const recent = new Map<string, FsListing>();
  let chosen = $state<string | null>(null);
  let showHidden = $state(false);
  let listing = $state<FsListing | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let revision = $state(0);
  const path = $derived(chosen ?? initial());

  $effect(() => {
    revision;
    const wanted = path;
    const hidden = showHidden;
    if (!active() || !wanted) return;
    const key = JSON.stringify([wanted, hidden]);
    listing = recent.get(key) ?? null;
    loading = true;
    error = null;
    let current = true;
    const owns = () => current && path === wanted && showHidden === hidden && active();
    const task = forkRpc(listFiles(wanted, hidden).pipe(
      Effect.tap((next) => Effect.sync(() => {
        if (!owns()) return;
        recent.delete(key);
        recent.set(key, next);
        while (recent.size > RECENT_DIRECTORIES) recent.delete(recent.keys().next().value!);
        listing = next;
      })),
      Effect.catchAll((caught) => Effect.sync(() => { if (owns()) error = shortFailureText(caught); })),
      Effect.ensuring(Effect.sync(() => { if (owns()) loading = false; })),
    ));
    return () => {
      current = false;
      loading = false;
      Effect.runFork(Fiber.interrupt(task));
    };
  });

  function showCached(): void {
    listing = recent.get(JSON.stringify([path, showHidden])) ?? null;
    error = null;
    loading = true;
  }

  return {
    get path() { return path; },
    get listing() { return listing; },
    get loading() { return loading; },
    get error() { return error; },
    get showHidden() { return showHidden; },
    go(path: string) { chosen = path; showCached(); },
    workspace() { chosen = null; showCached(); },
    toggleHidden() { showHidden = !showHidden; showCached(); },
    refresh() { revision += 1; },
  };
}
export type DirectoryState = ReturnType<typeof useDirectory>;
