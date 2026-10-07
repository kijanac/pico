<script lang="ts">
  import CompactContextForm from "@/features/chat/components/CompactContextForm.svelte";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import * as Sheet from "@/shared/ui/sheet";

  let { open = $bindable(false), sessionId, onError }: { open: boolean; sessionId: string; onError: (message: string) => void } = $props();

  function startCompaction(): void {
    open = false;
  }
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent>
    <SheetHeader title="compact context" />
    <CompactContextForm {sessionId} onStart={startCompaction} {onError} />
  </Sheet.BottomContent>
</Sheet.Root>
