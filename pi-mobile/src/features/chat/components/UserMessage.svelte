<script lang="ts">
  import type { UserMessage } from "@pi-mobile/protocol";

  let { msg }: { msg: UserMessage } = $props();
</script>

<div class="flex justify-end px-3 py-1.5">
  <div
    class="text-message font-readable max-w-[85%] min-w-0 overflow-hidden break-words rounded-[var(--radius-md)] px-3 py-2"
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
