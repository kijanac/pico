<script lang="ts">
  import { ArrowUp, ChevronLeft, FileText } from "@lucide/svelte";
  import * as Sheet from "@/shared/ui/sheet";
  import { Button } from "@/shared/ui/button";
  import StreamingMarkdown from "@/features/chat/components/StreamingMarkdown.svelte";
  import CodeFile from "./CodeFile.svelte";
  import PdfPreview from "./PdfPreview.svelte";
  import ImagePreview from "./ImagePreview.svelte";
  import ImageDownload from "./ImageDownload.svelte";
  import DirectoryView from "./DirectoryView.svelte";
  import EditPreview from "./EditPreview.svelte";
  import { imageFileUrl } from "./image-preview";
  import { useFile } from "./use-file.svelte";
  import { useDirectory } from "./use-directory.svelte";
  import { useFileChange } from "./use-file-change.svelte";
  import { provideFileOpener, type FileRequest } from "./file-links";
  import { inferLangFromPath } from "@/shared/lib/highlighter";
  import { shortPath } from "@/shared/lib/format";

  let { open = $bindable(false), request = $bindable(null), cwd }: {
    open: boolean;
    request: FileRequest | null;
    cwd: string | undefined;
  } = $props();

  let trail = $state<FileRequest[]>([]);
  const directory = useDirectory(() => cwd, () => open && !request);
  const opened = useFile(() => request?.edit ? null : request, () => open);
  const reviewed = useFileChange(() => request?.edit, () => open);
  const file = $derived(request && !request.edit ? opened.file : null);
  const failure = $derived(opened.failure);
  const selectedPath = $derived(request?.edit ? reviewed.change?.path ?? request.path : file?.path ?? request?.path);
  const path = $derived(selectedPath ?? directory.listing?.path ?? directory.path ?? "");
  const lang = $derived(file ? inferLangFromPath(file.path) : null);
  const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
  const nameOf = (path: string) => path.split("/").filter(Boolean).pop() || "file";

  provideFileOpener((path, edit) => {
    if (request) trail = [...trail, request];
    request = { path, edit, relativeTo: file ? folderOf(file.path) : cwd };
  });

  function back(): void {
    request = trail.at(-1) ?? null;
    trail = trail.slice(0, -1);
  }

  function currentFile(): void {
    if (!request) return;
    trail = [...trail, request];
    request = { path, relativeTo: request.relativeTo };
  }

  $effect(() => { if (!open) trail = []; });
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent drawerSize="wide" class="h-[min(86dvh,var(--sheet-available-height))] [--sheet-max-height:86dvh]">
    <Sheet.Header class="hairline-b h-16 shrink-0 flex-row items-center gap-1 space-y-0 px-2 py-2 text-left {file?.kind === 'image' || request?.edit ? 'pr-24' : 'pr-12'}">
      {#if request}
        <Button type="button" variant="ghost" size="icon" onclick={back} aria-label={trail.length > 0 ? "Back" : "Back to files"} class="size-11 shrink-0 text-[color:var(--color-fg-muted)]">
          <ChevronLeft class="size-4" />
        </Button>
      {:else}
        <Button type="button" variant="ghost" size="icon" disabled={!directory.listing?.parent} onclick={() => directory.listing?.parent && directory.go(directory.listing.parent)} aria-label="Parent directory" class="size-11 shrink-0 text-[color:var(--color-fg-muted)]">
          <ArrowUp class="size-4" />
        </Button>
      {/if}
      <div class="min-w-0 flex-1 px-1">
        <Sheet.Title class="type-title truncate font-medium" title={request ? nameOf(path) : "files"}>{request ? nameOf(path) : "files"}</Sheet.Title>
        <Sheet.Description class="type-meta truncate text-[color:var(--color-fg-muted)]" title={path}>{request?.edit ? reviewed.change ? "saved edit · " : "edit · " : request ? "current file · " : ""}{shortPath(path, 4) || "session folder"}</Sheet.Description>
      </div>
      {#if request?.edit}
        <Button type="button" variant="ghost" size="icon" class="absolute top-1 right-12 size-11 text-[color:var(--color-fg-muted)]" onclick={currentFile} aria-label="Open current file" title="open current file"><FileText class="size-4" /></Button>
      {:else if file?.kind === "image"}
        <ImageDownload href={imageFileUrl(file.path, true)} filename={nameOf(file.path)} />
      {/if}
    </Sheet.Header>
    <div class={request ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
      <DirectoryView {directory} onOpen={(path) => { trail = []; request = { path }; }} />
    </div>
    {#if request?.edit}
      <EditPreview review={request.edit} change={reviewed.change} failed={reviewed.failed} onRetry={reviewed.retry} />
    {:else if request}
      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3" class:overflow-x-hidden={file?.kind === "text"} tabindex="-1">
        {#if failure}
          <div role="alert" class="type-copy text-[color:var(--color-fg-muted)]">
            <p>{file ? "couldn't refresh" : "couldn't open"} {request.path}: {failure}</p>
            <Button variant="ghost" size="sm" class="min-h-11" onclick={opened.retry}>try again</Button>
          </div>
        {/if}
        {#if file?.kind === "pdf"}
          {#key file.path}<PdfPreview path={file.path} />{/key}
        {:else if file?.kind === "image"}
          {#key request}<ImagePreview src={imageFileUrl(file.path)} label={nameOf(file.path)} />{/key}
        {:else if file?.kind === "text" && lang === "markdown"}
          <StreamingMarkdown text={file.text} done horizontalScroll />
        {:else if file?.kind === "text"}
          <CodeFile text={file.text} {lang} />
        {:else if !failure}
          <p class="type-copy text-[color:var(--color-fg-muted)]" role="status">opening {request.path}…</p>
        {/if}
      </div>
    {/if}
  </Sheet.BottomContent>
</Sheet.Root>
