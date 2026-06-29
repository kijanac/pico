<script lang="ts">
  import CompactContextForm from "@/features/chat/components/CompactContextForm.svelte";
  import { haptics } from "@/shared/mobile/haptics";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import * as Sheet from "@/shared/ui/sheet";

  let { open = $bindable(false), hostId, sessionId }: { open: boolean; hostId: string; sessionId: string } = $props();

  function startCompaction(): void {
    haptics.light();
    open = false;
  }
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent>
    <SheetHeader title="compact context" />
    <CompactContextForm {hostId} {sessionId} onStart={startCompaction} />
  </Sheet.BottomContent>
</Sheet.Root>
