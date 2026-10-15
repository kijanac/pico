<script lang="ts">
  import type { ImageContent } from "@pico/protocol";
  import { imageDataUrl } from "@/shared/mobile/image-content";
  import { imageOpener } from "@/features/chat/files/image-preview";

  let {
    images,
    altPrefix = "image",
    imageClass = "max-h-44 min-h-20 object-cover",
    interactive = false,
    class: className = "",
  }: {
    images: readonly ImageContent[];
    altPrefix?: string;
    imageClass?: string;
    interactive?: boolean;
    class?: string;
  } = $props();
  const open = imageOpener();
</script>

{#if images.length > 0}
  <div class={`grid gap-1 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"} ${className}`}>
    {#each images as image, index}
      {#if interactive && open}
        <button type="button" aria-label={`Open ${altPrefix} ${index + 1}`} onclick={() => open(image, `${altPrefix} ${index + 1}`)} class="min-h-11 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] focus-visible:outline-2 focus-visible:outline-[color:var(--color-accent)]">
          <img src={imageDataUrl(image)} alt={`${altPrefix} ${index + 1}`} loading="lazy" decoding="async" class={`${imageClass} w-full rounded-[var(--radius-sm)]`} />
        </button>
      {:else}
        <img src={imageDataUrl(image)} alt={`${altPrefix} ${index + 1}`} loading="lazy" decoding="async" class={`${imageClass} w-full rounded-[var(--radius-sm)]`} />
      {/if}
    {/each}
  </div>
{/if}
