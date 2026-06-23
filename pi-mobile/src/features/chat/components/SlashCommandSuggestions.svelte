<script lang="ts">
  import { FileText, Hash, Puzzle, Sparkles } from "@lucide/svelte";
  import type { CommandEntry } from "@/features/chat/components/slash-commands.state.svelte";

  let {
    entries,
    selectedIndex,
    loading,
    error,
    onPick,
    onSelect,
  }: {
    entries: readonly CommandEntry[];
    selectedIndex: number;
    loading: boolean;
    error: string | null;
    onPick: (entry: CommandEntry) => void;
    onSelect: (index: number) => void;
  } = $props();

  function label(entry: CommandEntry): string {
    return `/${entry.name}`;
  }
</script>

<div class="hairline-b max-h-56 overflow-y-auto px-2 py-2">
  {#if loading}
    <div class="type-copy px-2 py-2 text-[color:var(--color-fg-muted)]">loading commands…</div>
  {:else if error}
    <div class="type-copy px-2 py-2 text-[color:var(--color-danger)]">{error}</div>
  {:else if entries.length === 0}
    <div class="type-copy px-2 py-2 text-[color:var(--color-fg-muted)]">no matches</div>
  {:else}
    <div class="space-y-1">
      {#each entries as entry, index (entry.kind + entry.name)}
        <button
          type="button"
          onpointerdown={(event) => event.preventDefault()}
          onpointerenter={() => onSelect(index)}
          onclick={() => onPick(entry)}
          class={`flex w-full items-start gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left ${index === selectedIndex ? "bg-[color:var(--color-surface)]" : "active:bg-[color:var(--color-surface)]"}`}
        >
          <span class="mt-0.5 text-[color:var(--color-fg-faint)]">
            {#if entry.kind === "prompt"}<FileText class="size-3" />{:else if entry.kind === "skill"}<Sparkles class="size-3" />{:else if entry.kind === "extension"}<Puzzle class="size-3" />{:else}<Hash class="size-3" />{/if}
          </span>
          <span class="min-w-0 flex-1">
            <span class="type-meta block truncate text-[color:var(--color-fg)]">{label(entry)}</span>
            <span class="type-meta block truncate text-[color:var(--color-fg-muted)]">{entry.description}</span>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
