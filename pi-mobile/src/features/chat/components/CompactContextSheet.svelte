<script lang="ts">
  import CompactContextForm from "@/features/chat/components/CompactContextForm.svelte";
  import { haptics } from "@/shared/mobile/haptics";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import * as Sheet from "@/shared/ui/sheet";

  let { open = $bindable(false), sessionId }: { open: boolean; sessionId: string } = $props();

  function startCompaction(): void {
    haptics.light();
    open = false;
  }
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent>
    <SheetHeader title="compact context" />
    <CompactContextForm {sessionId} onStart={startCompaction} />
  </Sheet.BottomContent>
</Sheet.Root>
