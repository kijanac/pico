<script lang="ts">
  import * as Sheet from "@/shared/ui/sheet";
  import ImagePreview from "./ImagePreview.svelte";
  import ImageDownload from "./ImageDownload.svelte";
  import { imagePreviewUrl, type ImageRequest } from "./image-preview";

  let { request = $bindable(null) }: { request: ImageRequest | null } = $props();
  const src = $derived(request ? imagePreviewUrl(request.image) : null);
</script>

<Sheet.Root bind:open={() => request !== null, (open) => { if (!open) request = null; }}>
  <Sheet.BottomContent drawerSize="wide" class="[--sheet-max-height:86dvh]">
    <Sheet.Header class="hairline-b px-3 py-3 text-left {src ? 'pr-24' : 'pr-12'}">
      <Sheet.Title class="type-title truncate font-medium">{request?.label ?? "image"}</Sheet.Title>
      {#if request && src}
        <ImageDownload href={src} filename={`image.${request.image.mimeType.split("/")[1]}`} />
      {/if}
    </Sheet.Header>
    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {#if request && src}
        {#key request}<ImagePreview {src} label={request.label} />{/key}
      {:else if request}
        <p role="alert" class="type-copy text-[color:var(--color-fg-muted)]">this image format can't be previewed here</p>
      {/if}
    </div>
  </Sheet.BottomContent>
</Sheet.Root>
