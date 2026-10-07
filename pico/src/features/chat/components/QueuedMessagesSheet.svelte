<script lang="ts">
  import { Pencil } from "@lucide/svelte";
  import type { QueueItem } from "@pico/protocol";
  import { Button } from "@/shared/ui/button";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import * as Sheet from "@/shared/ui/sheet";

  let {
    open = $bindable(false),
    queue,
    error,
    clearing,
    onClear,
  }: {
    open: boolean;
    queue: readonly QueueItem[];
    error: string | null;
    clearing: boolean;
    onClear: () => void | Promise<void>;
  } = $props();

  const steering = $derived(queue.filter((message) => message.mode === "steer"));
  const followUp = $derived(queue.filter((message) => message.mode === "follow_up"));
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent class="max-h-[75dvh]">
    <SheetHeader title="queued messages" />
    <div class="flex-1 overflow-y-auto px-3 py-3">
      {#if error}<div class="type-copy text-[color:var(--color-danger)]">{error}</div>{/if}
      {#if queue.length === 0}<div class="type-copy rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-center text-[color:var(--color-fg-muted)]">no queued messages</div>{/if}
      {@render QueueSection("steering", steering)}
      {@render QueueSection("follow-up", followUp)}
    </div>
    {#if queue.length > 0}
      <div class="hairline-t px-3 py-2">
        <Button type="button" variant="outline" disabled={clearing} onclick={onClear} class="w-full">
          <Pencil class="size-3.5" />
          {clearing ? "moving…" : "move to the composer"}
        </Button>
      </div>
    {/if}
  </Sheet.BottomContent>
</Sheet.Root>

{#snippet QueueSection(label: string, items: readonly QueueItem[])}
  {#if items.length > 0}
    <div class="mb-3">
      <div class="label mb-1.5">{label}</div>
      <div class="space-y-1.5">
        {#each items as item, index (`${index}:${item.text}`)}
          <div class="type-copy whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[color:var(--color-fg)]">{item.text}</div>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}
