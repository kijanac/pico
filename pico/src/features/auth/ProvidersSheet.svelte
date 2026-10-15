<script lang="ts">
  import * as Sheet from "@/shared/ui/sheet";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import ProvidersPanel from "./ProvidersPanel.svelte";

  let { open = $bindable(false) }: { open: boolean } = $props();
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent class="h-[min(82dvh,var(--sheet-available-height))] [--sheet-max-height:82dvh]">
    <SheetHeader title="providers" />
    <ProvidersPanel />
  </Sheet.BottomContent>
</Sheet.Root>
