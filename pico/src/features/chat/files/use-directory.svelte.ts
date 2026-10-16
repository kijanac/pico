import { listFiles } from "@/features/chat/api";
import { shortFailureText } from "@/shared/lib/host-issues";
import { useCachedRead } from "@/shared/lib/use-cached-read.svelte";

const RECENT_DIRECTORIES = 8;

export function useDirectory(initial: () => string | undefined, active: () => boolean) {
  let chosen = $state<string | null>(null);
  let showHidden = $state(false);
  const path = $derived(chosen ?? initial());
  const read = useCachedRead(() => path ? {
    key: JSON.stringify([path, showHidden]),
    read: listFiles(path, showHidden),
  } : null, () => active() && !!path, { capacity: RECENT_DIRECTORIES });

  return {
    get path() { return path; },
    get listing() { return read.value; },
    get loading() { return read.loading; },
    get error() { return read.failure === null ? null : shortFailureText(read.failure); },
    get showHidden() { return showHidden; },
    go(path: string) { chosen = path; read.showCached(); },
    workspace() { chosen = null; read.showCached(); },
    toggleHidden() { showHidden = !showHidden; read.showCached(); },
    refresh: read.retry,
  };
}
export type DirectoryState = ReturnType<typeof useDirectory>;
