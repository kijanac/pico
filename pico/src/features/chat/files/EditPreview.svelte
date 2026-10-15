<script lang="ts">
  import type { FileChange } from "@pico/protocol";
  import DiffSegment from "@/features/chat/components/DiffSegment.svelte";
  import EditDiff from "@/features/chat/components/EditDiff.svelte";
  import { Button } from "@/shared/ui/button";
  import type { EditReview } from "./file-links";
  import { missingEditContext } from "./tool-file";

  let { review, change, failed, onRetry }: {
    review: EditReview;
    change: FileChange | null;
    failed: boolean;
    onRetry: () => void;
  } = $props();
</script>

<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3" tabindex="-1">
    {#if change}
      <DiffSegment oldText={change.before} newText={change.after} path={change.path} full />
    {:else if review.ref?.kind === "saved" && !failed}
      <p class="type-copy text-[color:var(--color-fg-muted)]" role="status">opening saved edit…</p>
    {:else}
      {#if failed}
        <div class="mb-2 flex items-center justify-between gap-2 text-[color:var(--color-fg-muted)]">
          <p class="type-meta" role="alert">couldn't open the saved edit</p>
          <Button variant="ghost" size="sm" class="min-h-11 shrink-0" onclick={onRetry}>try again</Button>
        </div>
      {/if}
      <p class="type-meta mb-2 text-[color:var(--color-fg-faint)]" title={failed ? "saved edit unavailable" : missingEditContext(review)}>changed lines only</p>
      <EditDiff args={review.args} />
    {/if}
</div>
