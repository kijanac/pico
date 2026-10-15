<script lang="ts">
  import { ChevronRight, Eye, File, Folder, FolderRoot, Image, RefreshCw } from "@lucide/svelte";
  import { Input } from "@/shared/ui/input";
  import { Button } from "@/shared/ui/button";
  import ActionRow from "@/shared/components/ActionRow.svelte";
  import type { DirectoryState } from "./use-directory.svelte";

  let { directory, onOpen }: { directory: DirectoryState; onOpen: (path: string) => void } = $props();
  let query = $state("");
  let queryPath: string | undefined;
  $effect(() => {
    const path = directory.path;
    if (queryPath === path) return;
    queryPath = path;
    query = "";
  });
  const id = $props.id();
  const entries = $derived(directory.listing?.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? []);
  const isImage = (name: string) => /\.(png|jpe?g|gif|webp|avif)$/i.test(name);
  const sizeLabel = (size: number | null) => size === null ? "" : size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="hairline-b flex shrink-0 items-center gap-1 px-3 py-2">
    <label class="sr-only" for={`${id}-filter`}>filter this folder</label>
    <Input id={`${id}-filter`} role="searchbox" data-keyboard-editor bind:value={query} placeholder="filter files…" autocomplete="off" class="type-input h-11 min-w-0 flex-1" />
    <Button variant="ghost" size="icon" aria-label="Workspace folder" title="workspace folder" class="size-11 shrink-0" onclick={() => { query = ""; directory.workspace(); }}><FolderRoot class="size-4" /></Button>
    <Button variant="ghost" size="icon" aria-label="Show hidden files" title="show hidden files" class="size-11 shrink-0 aria-pressed:text-[color:var(--color-accent)]" aria-pressed={directory.showHidden} onclick={directory.toggleHidden}><Eye class="size-4" /></Button>
    <Button variant="ghost" size="icon" aria-label="Refresh directory" title="refresh directory" class="size-11 shrink-0" disabled={directory.loading} onclick={directory.refresh}><RefreshCw class={directory.loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} /></Button>
    <span class="sr-only" role="status">{directory.loading ? "refreshing folder" : ""}</span>
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3" aria-busy={directory.loading}>
    {#if directory.error}
      <div role="alert" class="type-copy py-3 text-[color:var(--color-danger)]">
        <p>{directory.listing ? "couldn't refresh" : "couldn't open folder"}: {directory.error}</p>
        <Button variant="ghost" size="sm" class="min-h-11" onclick={directory.refresh}>try again</Button>
      </div>
    {/if}
    {#if directory.listing}
      {#each entries as entry (entry.name)}
        <ActionRow disabled={entry.kind === "other"} class="hairline-b min-h-11" onclick={() => {
          const listing = directory.listing;
          if (!listing) return;
          const path = `${listing.path.replace(/\/$/, "")}/${entry.name}`;
          if (entry.kind === "directory") { query = ""; directory.go(path); }
          else onOpen(path);
        }}>
          <span class="shrink-0 text-[color:var(--color-fg-muted)]">
            {#if entry.kind === "directory"}<Folder class="size-4" />{:else if isImage(entry.name)}<Image class="size-4" />{:else}<File class="size-4" />{/if}
          </span>
          <span class="type-copy min-w-0 flex-1 truncate" title={entry.name} dir="auto">{entry.name}</span>
          {#if entry.kind === "directory"}<ChevronRight class="size-3 text-[color:var(--color-fg-faint)]" />{:else}<span class="type-meta shrink-0 tabular-nums text-[color:var(--color-fg-faint)]">{entry.kind === "other" ? "unavailable" : sizeLabel(entry.size)}</span>{/if}
        </ActionRow>
      {:else}
        <p class="type-copy py-4 text-[color:var(--color-fg-muted)]">{query.trim() ? "no names match your filter" : "this folder is empty"}</p>
      {/each}
    {:else if !directory.error}
      <p class="type-copy py-4 text-[color:var(--color-fg-muted)]">{directory.loading ? "opening folder…" : "session folder unavailable"}</p>
    {/if}
  </div>
</div>
