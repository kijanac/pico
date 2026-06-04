<script lang="ts">
  import type { EditToolArgs } from "@pi-mobile/protocol";
  import DiffSegment from "@/features/chat/components/DiffSegment.svelte";

  let { args }: { args: EditToolArgs } = $props();

  type EditSegment = EditToolArgs["edits"][number];

  const segments = $derived(args.edits.filter((segment: EditSegment) => segment.oldText.length > 0 || segment.newText.length > 0));
</script>

<div class="space-y-2">
  {#each segments as segment}
    <DiffSegment oldText={segment.oldText} newText={segment.newText} path={args.path} />
  {:else}
    <div class="text-meta italic text-[color:var(--color-fg-muted)]">waiting for edit args…</div>
  {/each}
</div>
