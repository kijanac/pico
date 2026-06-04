<script lang="ts">
  import { Check } from "@lucide/svelte";
  import { Button } from "@/shared/ui/button";
  import { Input } from "@/shared/ui/input";
  import * as Sheet from "@/shared/ui/sheet";

  let {
    open = $bindable(false),
    initialTitle,
    saving = false,
    onSave,
  }: {
    open: boolean;
    initialTitle: string;
    saving?: boolean;
    onSave: (newTitle: string) => void;
  } = $props();

  let value = $state("");

  $effect(() => {
    if (open) value = initialTitle;
  });

  const canSave = $derived(!saving && value.trim().length > 0 && value.trim() !== initialTitle);

  function commit(): void {
    if (!canSave) return;
    onSave(value.trim());
  }
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent>
    <Sheet.Header class="hairline-b space-y-0 px-3 py-3 pr-12 text-left">
      <Sheet.Title class="text-title min-w-0 flex-1 px-1 font-medium">Rename session</Sheet.Title>
    </Sheet.Header>

    <div class="px-3 pt-3 pb-2">
      <Input
        autofocus
        type="text"
        bind:value
        onkeydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        placeholder="session title"
        class="text-input h-10"
      />
    </div>

    <div class="flex gap-2 px-3 pb-2 pt-1">
      <Button type="button" variant="outline" onclick={() => (open = false)} class="flex-1">cancel</Button>
      <Button type="button" onclick={commit} disabled={!canSave} class="flex-1">
        <Check class="size-3" />
        {saving ? "saving…" : "save"}
      </Button>
    </div>
  </Sheet.BottomContent>
</Sheet.Root>
