<script lang="ts">
  import { ChevronLeft } from "@lucide/svelte";
  import type { FsFile } from "@pico/protocol/rpc";
  import * as Sheet from "@/shared/ui/sheet";
  import { Button } from "@/shared/ui/button";
  import StreamingMarkdown from "@/features/chat/components/StreamingMarkdown.svelte";
  import CodeFile from "@/features/chat/files/CodeFile.svelte";
  import { readFile } from "@/features/chat/api";
  import { describeReadFailure, provideFileOpener, type FileRequest } from "@/features/chat/files/file-links";
  import { inferLangFromPath } from "@/shared/lib/highlighter";
  import { shortFailureText } from "@/shared/lib/host-issues";
  import { runRpc } from "@/shared/lib/rpc-client";
  import { shortPath } from "@/shared/lib/format";

  let { request = $bindable(null) }: { request: FileRequest | null } = $props();

  let shown = $state<FileRequest | null>(null);
  let trail = $state<FileRequest[]>([]);
  let file = $state<FsFile | null>(null);
  let failure = $state<string | null>(null);

  const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
  const nameOf = (path: string) => path.split("/").filter(Boolean).pop() || "file";

  provideFileOpener((path) => {
    if (shown) trail = [...trail, shown];
    request = { path, relativeTo: file ? folderOf(file.path) : undefined };
  });

  function back(): void {
    request = trail.at(-1) ?? null;
    trail = trail.slice(0, -1);
  }

  $effect(() => {
    const wanted = request;
    if (!wanted) return;
    if (!shown) trail = [];
    shown = wanted;
    let superseded = false;
    file = null;
    failure = null;
    runRpc(readFile(wanted.path, wanted.relativeTo))
      .then((read) => {
        if (!superseded) file = read;
      })
      .catch((error: unknown) => {
        if (!superseded) failure = describeReadFailure(shortFailureText(error));
      });
    return () => {
      superseded = true;
    };
  });

  const lang = $derived(file ? inferLangFromPath(file.path) : null);
</script>

<Sheet.Root bind:open={() => request !== null, (open) => {
  if (open) return;
  request = null;
  shown = null;
}}>
  <Sheet.BottomContent class="max-h-[86dvh]">
    <Sheet.Header class="hairline-b flex-row items-center gap-1 space-y-0 px-2 py-2 pr-12 text-left">
      {#if trail.length > 0}
        <Button type="button" variant="ghost" size="icon" onclick={back} aria-label="Back" class="rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] hover:bg-transparent active:bg-[color:var(--color-surface)]">
          <ChevronLeft class="size-4" />
        </Button>
      {/if}
      <div class="min-w-0 flex-1 px-1">
        <Sheet.Title class="type-title truncate font-medium">{nameOf(file?.path ?? shown?.path ?? "")}</Sheet.Title>
        {#if file}<Sheet.Description class="type-meta truncate text-[color:var(--color-fg-muted)]">{shortPath(file.path, 4)}</Sheet.Description>{/if}
      </div>
    </Sheet.Header>
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3" tabindex="-1">
      {#if failure}
        <p class="type-copy text-[color:var(--color-fg-muted)]">couldn't open {shown?.path}: {failure}</p>
      {:else if file && lang === "markdown"}
        <StreamingMarkdown text={file.text} done />
      {:else if file}
        <CodeFile text={file.text} {lang} />
      {:else}
        <p class="type-copy text-[color:var(--color-fg-muted)]">opening {shown?.path}…</p>
      {/if}
    </div>
  </Sheet.BottomContent>
</Sheet.Root>
