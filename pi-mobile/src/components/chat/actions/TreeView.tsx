import { For, Show, createResource, createSignal, type JSX } from "solid-js";
import { Loader2 } from "lucide-solid";
import type { TreeEntry } from "@pi-mobile/protocol";
import { getSessionTree, navigateSessionTree } from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";
import { ToggleRow } from "./shared";
import type { ActionErrorHandler } from "./types";

export default function TreeView(props: { sessionId: string; onDone: () => void; onError: ActionErrorHandler }): JSX.Element {
  const [jumping, setJumping] = createSignal<string | null>(null);
  const [summarize, setSummarize] = createSignal(false);
  const [tree, { refetch }] = createResource(async () => {
    const baseUrl = await getBridgeUrl();
    return getSessionTree(baseUrl, props.sessionId);
  });

  async function jump(entry: TreeEntry) {
    if (jumping() || entry.current) return;
    setJumping(entry.id);
    props.onError(null);
    try {
      const baseUrl = await getBridgeUrl();
      await navigateSessionTree(baseUrl, props.sessionId, { entryId: entry.id, summarize: summarize() });
      props.onDone();
    } catch (e) {
      props.onError(String(e));
      await refetch();
    } finally {
      setJumping(null);
    }
  }

  return (
    <div class="flex-1 overflow-y-auto py-2">
      <div class="px-3 pb-2">
        <ToggleRow label="summarize abandoned branch" checked={summarize()} disabled={jumping() !== null} onChange={setSummarize} />
      </div>
      <Show when={tree.loading}><div class="px-3 py-3 text-[12px] text-[color:var(--color-fg-faint)]">loading tree…</div></Show>
      <Show when={(tree()?.entries.length ?? 0) === 0 && !tree.loading}><div class="px-3 py-6 text-center text-[12px] text-[color:var(--color-fg-faint)]">no persisted tree entries yet</div></Show>
      <For each={tree()?.entries ?? []}>
        {(entry) => (
          <button type="button" onClick={() => jump(entry)} disabled={jumping() !== null || entry.current} class="hairline-b flex w-full items-start gap-2 px-3 py-2 text-left active:bg-[color:var(--color-surface)] disabled:opacity-75">
            <span class="pt-0.5 font-mono text-[10px] text-[color:var(--color-fg-faint)]" style={{ width: `${Math.max(0, entry.depth) * 12 + 12}px` }}>{entry.childCount > 1 ? "├" : "│"}</span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">
                <span>{entry.role ?? entry.type}</span>
                <Show when={entry.current}><span class="text-[color:var(--color-accent)]">current</span></Show>
                <Show when={entry.onCurrentPath && !entry.current}><span>path</span></Show>
              </span>
              <span class="mt-0.5 line-clamp-2 block text-[12.5px] text-[color:var(--color-fg)]">{entry.label ? `${entry.label}: ` : ""}{entry.text || "—"}</span>
            </span>
            <Show when={jumping() === entry.id}><Loader2 size={14} class="mt-1 text-[color:var(--color-fg-muted)]" style={{ animation: "spin 1s linear infinite" }} /></Show>
          </button>
        )}
      </For>
    </div>
  );
}
