<script lang="ts">
  import CompactContextForm from "@/features/chat/components/CompactContextForm.svelte";
  import { haptics } from "@/shared/mobile/haptics";
  import * as Sheet from "@/shared/ui/sheet";

  let { open = $bindable(false), sessionId }: { open: boolean; sessionId: string } = $props();

  function startCompaction(): void {
    haptics.light();
    open = false;
  }
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent>
    <Sheet.Header class="hairline-b space-y-0 px-3 py-3 pr-12 text-left">
      <Sheet.Title class="type-title min-w-0 flex-1 px-1 font-medium">compact context</Sheet.Title>
    </Sheet.Header>
    <CompactContextForm {sessionId} onStart={startCompaction} />
  </Sheet.BottomContent>
</Sheet.Root>
