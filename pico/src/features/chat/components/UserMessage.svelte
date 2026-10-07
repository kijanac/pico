<script lang="ts">
  import type { ImageContent } from "@pico/protocol";
  import ImageGrid from "@/features/chat/components/ImageGrid.svelte";
  import { chatLogState, type OutboxItem } from "@/features/chat/model/chat-log.state.svelte";
  import { queuedMessageActionsState } from "@/features/chat/model/queued-message-actions.state.svelte";

  // A saved message, one waiting in pi's queue, or one from the outbox.
  let {
    text,
    images = [],
    queued = false,
    outbox,
    hostId,
    sessionId,
  }: {
    text: string;
    images?: readonly ImageContent[];
    queued?: boolean;
    outbox?: OutboxItem;
    hostId: string;
    sessionId: string;
  } = $props();

  const failed = $derived(outbox?.state === "failed" || outbox?.state === "lost");
  const pending = $derived(outbox !== undefined && !failed);

  function discard(cid: string): void {
    const item = chatLogState.discard(cid);
    if (item) queuedMessageActionsState.recall(hostId, sessionId, item.text, item.images);
  }
</script>

{#snippet MessageBody()}
  {#if text.trim().length > 0}
    <div>{text}</div>
  {/if}
  <ImageGrid {images} altPrefix="attached image" class={text.trim().length > 0 ? "mt-2" : ""} />
{/snippet}

<div class="flex flex-col items-end px-3 py-1.5">
  {#if queued}
    <button
      type="button"
      class="type-message font-readable max-w-[85%] min-w-0 overflow-hidden break-words rounded-[var(--radius-md)] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-3 py-2 text-left text-[color:var(--color-fg-muted)] opacity-90 transition-opacity duration-200 active:opacity-70 disabled:opacity-60"
      disabled={queuedMessageActionsState.restoring}
      onclick={() => void queuedMessageActionsState.restoreQueue(hostId, sessionId)}
      aria-label="Edit queued messages"
      title="Move queued messages to the composer"
    >
      {@render MessageBody()}
    </button>
  {:else}
    <div
      class="type-message font-readable max-w-[85%] min-w-0 overflow-hidden break-words rounded-[var(--radius-md)] bg-[color:var(--color-surface-2)] px-3 py-2 text-[color:var(--color-fg)] transition-opacity duration-200"
      class:opacity-60={pending}
      class:border={failed}
      class:border-[color:var(--color-danger)]={failed}
    >
      {@render MessageBody()}
    </div>
  {/if}

  {#if queued && queuedMessageActionsState.restoreError}
    <div class="type-meta mt-1 max-w-[85%] text-right text-[color:var(--color-danger)]">{queuedMessageActionsState.restoreError}</div>
  {/if}

  {#if outbox && failed}
    <div class="type-meta mt-1 flex max-w-[85%] items-baseline justify-end gap-2 text-right text-[color:var(--color-danger)]">
      <button type="button" class="active:opacity-70" onclick={() => chatLogState.retry(outbox.cid)}>
        {outbox.state === "lost" ? "not sent: the host restarted · send again" : `not delivered${outbox.error ? `: ${outbox.error}` : ""} · tap to retry`}
      </button>
      <button type="button" class="text-[color:var(--color-fg-muted)] active:opacity-70" onclick={() => discard(outbox.cid)}>edit</button>
    </div>
  {/if}
</div>
