<script lang="ts">
  import { Loader2 } from "@lucide/svelte";
  import type { SessionTree } from "@pico/protocol";
  import type { ActionErrorHandler } from "./types";
  import { getSessionTree, navigateSessionTree } from "@/features/chat/api";
  import { hostIssueSummary } from "@/shared/lib/host-issues";
  import { runOnHost } from "@/shared/lib/rpc-client";
  import ActionRow from "@/shared/components/ActionRow.svelte";

  type TreeEntry = SessionTree["entries"][number];

  let { hostId, sessionId, onDone, onError }: { hostId: string; sessionId: string; onDone: () => void; onError: ActionErrorHandler } = $props();

  let jumping = $state<string | null>(null);
  let summarize = $state(false);
  let tree = $state<SessionTree | null>(null);
  let loading = $state(false);

  $effect(() => {
    void loadTree();
  });

  async function loadTree(): Promise<void> {
    loading = true;
    try {
      tree = await runOnHost(hostId, getSessionTree(sessionId));
    } catch (error) {
      onError(hostIssueSummary(error));
    } finally {
      loading = false;
    }
  }

  async function jump(entry: TreeEntry): Promise<void> {
    if (jumping || entry.current) return;
    jumping = entry.id;
    onError(null);
    try {
      await runOnHost(hostId, navigateSessionTree(sessionId, { entryId: entry.id, summarize }));
      onDone();
    } catch (error) {
      onError(hostIssueSummary(error));
      await loadTree();
    } finally {
      jumping = null;
    }
  }
</script>

<div class="flex-1 overflow-y-auto py-2">
  <div class="px-3 pb-2">
    <ActionRow variant="card" justify="between" disabled={jumping !== null} onclick={() => (summarize = !summarize)}>
      <span class="type-copy font-medium">summarize abandoned branch</span>
      <span class={summarize ? "type-meta text-[color:var(--color-accent)]" : "type-meta text-[color:var(--color-fg-muted)]"}>{summarize ? "on" : "off"}</span>
    </ActionRow>
  </div>
  {#if loading}<div class="type-copy px-3 py-3 text-[color:var(--color-fg-muted)]">loading tree…</div>{/if}
  {#if (tree?.entries.length ?? 0) === 0 && !loading}<div class="type-copy px-3 py-6 text-center text-[color:var(--color-fg-muted)]">no persisted tree entries yet</div>{/if}
  {#each tree?.entries ?? [] as entry (entry.id)}
    <ActionRow onclick={() => jump(entry)} disabled={jumping !== null || entry.current} align="start" class="py-2 disabled:opacity-75">
      <span class="type-label uppercase tracking-[0.08em] pt-0.5 font-mono text-[color:var(--color-fg-faint)]" style:width={`${Math.max(0, entry.depth) * 12 + 12}px`}>{entry.childCount > 1 ? "├" : "│"}</span>
      <span class="min-w-0 flex-1">
        <span class="type-label uppercase tracking-[0.08em] flex items-center gap-2 text-[color:var(--color-fg-faint)]">
          <span>{entry.role ?? entry.type}</span>
          {#if entry.current}<span class="text-[color:var(--color-accent)]">current</span>{/if}
          {#if entry.onCurrentPath && !entry.current}<span>path</span>{/if}
        </span>
        <span class="type-copy mt-0.5 line-clamp-2 block text-[color:var(--color-fg)]">{entry.label ? `${entry.label}: ` : ""}{entry.text || "—"}</span>
      </span>
      {#if jumping === entry.id}<Loader2 class="mt-1 size-3.5 animate-spin text-[color:var(--color-fg-muted)]" />{/if}
    </ActionRow>
  {/each}
</div>
