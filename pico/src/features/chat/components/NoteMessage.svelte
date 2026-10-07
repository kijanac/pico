<script lang="ts">
  import type { NoteEntry } from "@pico/protocol";
  import StreamingMarkdown from "@/features/chat/components/StreamingMarkdown.svelte";

  // A message an extension added, or a branch summary.
  let { msg }: { msg: NoteEntry } = $props();
</script>

<div class="px-3">
  <div class="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2">
    <div class="type-label uppercase tracking-[0.08em] mb-1 text-[color:var(--color-fg-faint)]">{msg.label}</div>
    <StreamingMarkdown text={msg.text} done={true} class="type-copy" />
  </div>
</div>
