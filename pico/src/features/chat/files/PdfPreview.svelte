<script lang="ts">
  import { ChevronLeft, ChevronRight, Minus, Plus } from "@lucide/svelte";
  import { Button } from "@/shared/ui/button";
  import { usePdfPreview } from "./use-pdf-preview.svelte";
  import { pdfFileUrl } from "./pdf-url";

  let { path }: { path: string } = $props();
  let container = $state<HTMLDivElement | null>(null);
  let viewer = $state<HTMLDivElement | null>(null);
  const preview = usePdfPreview(() => ({ container, viewer, path }));
</script>

<div class="flex flex-col gap-2">
  <div class="type-meta flex items-center justify-between gap-2">
    <div class="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={preview.total === 0 || preview.page === 1} onclick={preview.previous}><ChevronLeft class="size-4" /></Button>
      <span aria-live="polite" class="tabular-nums">{preview.total ? `${preview.page} / ${preview.total}` : "PDF"}</span>
      <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={preview.total === 0 || preview.page === preview.total} onclick={preview.next}><ChevronRight class="size-4" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={!preview.total} onclick={preview.zoomOut}><Minus class="size-4" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={!preview.total} onclick={preview.zoomIn}><Plus class="size-4" /></Button>
    </div>
    <div class="flex gap-3">
      <a href={pdfFileUrl(path)} target="_blank" rel="noopener noreferrer" class="touch-target inline-flex min-h-11 items-center underline">open</a>
      <a href={pdfFileUrl(path, true)} download class="touch-target inline-flex min-h-11 items-center underline">download</a>
    </div>
  </div>
  {#if preview.failure}<p role="alert" class="type-copy text-[color:var(--color-fg-muted)]">{preview.failure}</p>{/if}
  <div class="relative h-[58dvh] min-h-0 overflow-hidden rounded-[var(--radius-sm)] bg-[color:var(--color-surface)]" aria-label="PDF preview" aria-busy={preview.total === 0 && !preview.failure}>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div bind:this={container} class="absolute inset-0 overflow-auto overscroll-contain" tabindex="0" role="region" aria-label="PDF pages">
      <div bind:this={viewer} class="pdfViewer"></div>
    </div>
    {#if preview.total === 0 && !preview.failure}<p class="type-meta pointer-events-none absolute left-3 top-3 text-[color:var(--color-fg-muted)]">opening PDF…</p>{/if}
  </div>
</div>
