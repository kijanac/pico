<script lang="ts">
  import { Trash2 } from "@lucide/svelte";
  import type { QueueState } from "@pi-mobile/protocol";
  import { Button } from "@/shared/ui/button";
  import * as Sheet from "@/shared/ui/sheet";

  let {
    open = $bindable(false),
    queue,
    loading,
    error,
    clearing,
    onLoad,
    onClear,
  }: {
    open: boolean;
    queue: QueueState | null;
    loading: boolean;
    error: string | null;
    clearing: boolean;
    onLoad: () => void | Promise<void>;
    onClear: () => void | Promise<void>;
  } = $props();

  const queueCount = $derived((queue?.steering.length ?? 0) + (queue?.followUp.length ?? 0));

  $effect(() => {
    if (open) void onLoad();
  });
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="bottom" class="flex max-h-[75dvh] flex-col gap-0 overflow-hidden rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none" style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem)">
    <Sheet.Header class="hairline-b space-y-0 px-3 py-3 pr-12 text-left"><Sheet.Title class="min-w-0 flex-1 px-1 text-[13px] font-medium">queued messages</Sheet.Title></Sheet.Header>
    <div class="flex-1 overflow-y-auto px-3 py-3">
      {#if loading}<div class="text-[12px] text-[color:var(--color-fg-faint)]">loading queue…</div>{/if}
      {#if error}<div class="text-[12px] text-[color:var(--color-danger)]">{error}</div>{/if}
      {#if queue && queueCount === 0}<div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-center text-[12px] text-[color:var(--color-fg-faint)]">no queued messages</div>{/if}
      {#if queue}
        {@render QueueSection("steering", queue.steering)}
        {@render QueueSection("follow-up", queue.followUp)}
      {/if}
    </div>
    {#if queueCount > 0}
      <div class="hairline-t px-3 py-2">
        <Button type="button" variant="destructive" disabled={clearing} onclick={onClear} class="w-full bg-transparent text-[color:var(--color-danger)] hover:bg-[color:var(--color-surface)]">
          <Trash2 class="size-3.5" />
          {clearing ? "clearing…" : "clear queued messages"}
        </Button>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>

{#snippet QueueSection(label: string, items: readonly string[])}
  {#if items.length > 0}
    <div class="mb-3">
      <div class="label mb-1.5">{label}</div>
      <div class="space-y-1.5">
        {#each items as item}
          <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[12px] text-[color:var(--color-fg)]">{item}</div>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}
