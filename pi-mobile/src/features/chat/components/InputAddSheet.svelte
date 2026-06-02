<script lang="ts">
  import { tick } from "svelte";
  import { Hash, ImagePlus, Mic } from "@lucide/svelte";
  import * as Sheet from "@/shared/ui/sheet";

  let {
    open = $bindable(false),
    imageCount,
    maxImages,
    speechAvailable,
    onAttachImages,
    onToggleMic,
    onOpenCommands,
  }: {
    open: boolean;
    imageCount: number;
    maxImages: number;
    speechAvailable: boolean | null;
    onAttachImages: () => void | Promise<void>;
    onToggleMic: () => void | Promise<void>;
    onOpenCommands: () => void | Promise<void>;
  } = $props();

  async function closeThen(run: () => void | Promise<void>, waitForClose = false): Promise<void> {
    open = false;
    if (waitForClose) await tick();
    await run();
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="bottom" class="flex max-h-[45dvh] flex-col gap-0 overflow-hidden rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none" style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem)">
    <Sheet.Header class="hairline-b space-y-0 px-3 py-3 pr-12 text-left"><Sheet.Title class="min-w-0 flex-1 px-1 text-[13px] font-medium">add</Sheet.Title></Sheet.Header>
    <div class="grid grid-cols-3 gap-2 px-3 py-3">
      <button type="button" onclick={() => closeThen(onAttachImages)} disabled={imageCount >= maxImages} class="flex min-h-20 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-center active:bg-[color:var(--color-surface-2)] disabled:opacity-40">
        <ImagePlus class="size-5 text-[color:var(--color-fg-muted)]" />
        <span class="text-[12px] font-medium">image</span>
        <span class="text-[10px] text-[color:var(--color-fg-faint)]">{imageCount >= maxImages ? `max ${maxImages}` : "attach photo"}</span>
      </button>
      <button type="button" onclick={() => closeThen(onToggleMic)} disabled={speechAvailable === false} class="flex min-h-20 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-center active:bg-[color:var(--color-surface-2)] disabled:opacity-40">
        <Mic class="size-5 text-[color:var(--color-fg-muted)]" />
        <span class="text-[12px] font-medium">dictate</span>
        <span class="text-[10px] text-[color:var(--color-fg-faint)]">{speechAvailable === false ? "unavailable" : "speech to text"}</span>
      </button>
      <button type="button" onclick={() => closeThen(onOpenCommands, true)} class="flex min-h-20 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-center active:bg-[color:var(--color-surface-2)]">
        <Hash class="size-5 text-[color:var(--color-fg-muted)]" />
        <span class="text-[12px] font-medium">commands</span>
        <span class="text-[10px] text-[color:var(--color-fg-faint)]">slash palette</span>
      </button>
    </div>
  </Sheet.Content>
</Sheet.Root>
