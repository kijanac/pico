<script lang="ts">
  import type { UserMessage } from "@pico/protocol";
  import { isLocalEcho } from "@/features/chat/model/chat-log.state.svelte";

  let { msg }: { msg: UserMessage } = $props();

  const pending = $derived(isLocalEcho(msg.id));
</script>

<div class="flex justify-end px-3 py-1.5">
  <div
    class="type-message font-readable max-w-[85%] min-w-0 overflow-hidden break-words rounded-[var(--radius-md)] px-3 py-2 transition-opacity duration-200"
    class:opacity-60={pending}
    class:border={!!msg.queued}
    class:border-dashed={!!msg.queued}
    class:border-[color:var(--color-border-strong)]={!!msg.queued}
    class:bg-[color:var(--color-surface)]={!!msg.queued}
    class:text-[color:var(--color-fg-muted)]={!!msg.queued}
    class:opacity-90={!!msg.queued}
    class:bg-[color:var(--color-surface-2)]={!msg.queued}
    class:text-[color:var(--color-fg)]={!msg.queued}
  >
    {msg.text}
  </div>
</div>
