import { getSessionTree, navigateSessionTree } from "@/features/chat/api";
import type { SessionTree } from "@pico/protocol";
import { hostIssueSummary } from "@/shared/lib/host-issues";
import { runRpc } from "@/shared/lib/rpc-client";
import { createLatest } from "@/shared/lib/latest";
import type { ActionErrorHandler } from "./types";

export function useSessionTree(sessionId: () => string, onDone: () => void, onError: ActionErrorHandler) {
  let tree = $state<SessionTree | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let jumping = $state<string | null>(null);
  const reads = createLatest();
  let generation = 0;

  async function load(): Promise<void> {
    const id = sessionId();
    const owner = generation;
    const read = reads.begin();
    loading = true;
    error = null;
    try {
      const next = await runRpc(getSessionTree(id));
      if (owner === generation && reads.isCurrent(read)) tree = next;
    } catch (caught) {
      if (owner === generation && reads.isCurrent(read)) error = hostIssueSummary(caught);
    } finally {
      if (owner === generation && reads.isCurrent(read)) loading = false;
    }
  }

  $effect(() => {
    sessionId();
    generation += 1;
    tree = null;
    jumping = null;
    void load();
    return () => { generation += 1; reads.begin(); };
  });

  async function jump(entry: SessionTree["entries"][number], summarize: boolean): Promise<void> {
    if (jumping || entry.current || loading) return;
    const id = sessionId();
    const owner = generation;
    jumping = entry.id;
    onError(null);
    try {
      await runRpc(navigateSessionTree(id, { entryId: entry.id, summarize }));
      if (owner === generation) onDone();
    } catch (caught) {
      if (owner === generation) {
        onError(hostIssueSummary(caught));
        await load();
      }
    } finally {
      if (owner === generation) jumping = null;
    }
  }

  return {
    get tree() { return tree; },
    get loading() { return loading; },
    get error() { return error; },
    get jumping() { return jumping; },
    load,
    jump,
  };
}
