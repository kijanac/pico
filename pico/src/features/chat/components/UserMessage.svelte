<script lang="ts">
  import { X } from "@lucide/svelte";
  import type { QueuedUserMessage, UserMessage } from "@pico/protocol";
  import { removeQueuedMessage as removeQueuedMessageApi } from "@/features/chat/api";
  import ImageGrid from "@/features/chat/components/ImageGrid.svelte";
  import { chatLogState, isLocalEcho } from "@/features/chat/model/chat-log.state.svelte";
  import { chatQueueState } from "@/features/chat/model/chat-queue.state.svelte";
  import { queuedMessageActionsState } from "@/features/chat/model/queued-message-actions.state.svelte";
  import { haptics } from "@/shared/mobile/haptics";
  import { hostIssueSummary } from "@/shared/lib/host-issues";
  import { runOnHost } from "@/shared/lib/rpc-client";

  let { msg, hostId, sessionId }: { msg: UserMessage; hostId: string; sessionId: string } = $props();

  let queueActionBusy = $state<"recall" | "remove" | null>(null);
  let queueActionError = $state<string | null>(null);

  const failed = $derived(isLocalEcho(msg.id) && chatLogState.isEchoFailed(msg.id));
  const pending = $derived(isLocalEcho(msg.id) && !failed);
  const queuedMessage = $derived<QueuedUserMessage | null>(msg.queued === true ? msg : null);
  const images = $derived(msg.images ?? []);

  function retry(): void {
    haptics.light();
    chatLogState.retryLocalEcho(msg.id);
  }

  async function removeQueued(message: QueuedUserMessage, options: { recall: boolean }): Promise<void> {
    if (queueActionBusy) return;
    queueActionBusy = options.recall ? "recall" : "remove";
    queueActionError = null;

    try {
      const next = await runOnHost(hostId, removeQueuedMessageApi(sessionId, message.id));
      chatQueueState.set(hostId, sessionId, next);
      if (options.recall) {
        queuedMessageActionsState.recall(hostId, sessionId, message.text, message.mode, message.images);
      }
      haptics.light();
    } catch (error) {
      queueActionError = hostIssueSummary(error);
    } finally {
      queueActionBusy = null;
    }
  }
</script>

{#snippet MessageBody()}
  {#if msg.text.trim().length > 0}
    <div>{msg.text}</div>
  {/if}
  <ImageGrid {images} altPrefix="attached image" class={msg.text.trim().length > 0 ? "mt-2" : ""} />
{/snippet}

<div class="flex flex-col items-end px-3 py-1.5">
  {#if queuedMessage}
    <div class="relative max-w-[85%] min-w-0">
      <button
        type="button"
        class="type-message font-readable w-full min-w-0 overflow-hidden break-words rounded-[var(--radius-md)] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-3 py-2 pr-8 text-left text-[color:var(--color-fg-muted)] opacity-90 transition-opacity duration-200 active:opacity-70 disabled:opacity-60"
        disabled={queueActionBusy !== null}
        onclick={() => void removeQueued(queuedMessage, { recall: true })}
        aria-label="Edit queued message"
        title="Edit queued message"
      >
        {@render MessageBody()}
      </button>
      <button
        type="button"
        class="absolute right-1 top-1 flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-faint)] active:bg-[color:var(--color-surface-2)] active:text-[color:var(--color-fg-muted)] disabled:opacity-50"
        disabled={queueActionBusy !== null}
        onclick={() => void removeQueued(queuedMessage, { recall: false })}
        aria-label="Remove queued message"
        title="Remove queued message"
      >
        <X class="size-3.5" />
      </button>
    </div>
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

  {#if queueActionError}
    <div class="type-meta mt-1 max-w-[85%] text-right text-[color:var(--color-danger)]">{queueActionError}</div>
  {/if}

  {#if failed}
    <button type="button" class="type-meta mt-1 text-[color:var(--color-danger)] active:opacity-70" onclick={retry}>
      not delivered · tap to retry
    </button>
  {/if}
</div>
