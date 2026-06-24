<script lang="ts">
  import { X } from "@lucide/svelte";
  import type { ImageAttachment } from "@pico/protocol";

  let { images, onRemove }: { images: ImageAttachment[]; onRemove: (index: number) => void } = $props();
</script>

{#if images.length > 0}
  <div class="hairline-b flex gap-1.5 overflow-x-auto px-2 py-1.5">
    {#each images as image, index}
      <div class="relative h-14 w-14 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border)]">
        <img src={`data:${image.mimeType};base64,${image.data}`} alt="" class="h-full w-full object-cover" />
        <button
          type="button"
          onclick={() => onRemove(index)}
          class="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--color-bg)]/85 text-[color:var(--color-fg)] active:opacity-80"
          aria-label="Remove image"
        >
          <X class="size-2.5" />
        </button>
      </div>
    {/each}
  </div>
{/if}
