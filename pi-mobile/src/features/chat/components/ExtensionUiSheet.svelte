<script lang="ts">
  import * as Sheet from "@/shared/ui/sheet";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import { Button } from "@/shared/ui/button";
  import { Input } from "@/shared/ui/input";
  import { Textarea } from "@/shared/ui/textarea";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";

  let textValue = $state("");
  let sheetOpen = $state(false);
  let activeRequestId = $state<string | null>(null);
  const request = $derived(activeSessionState.extensionUiRequests[0]);

  $effect(() => {
    const nextId = request?.id ?? null;
    if (nextId === activeRequestId) return;
    activeRequestId = nextId;
    sheetOpen = Boolean(request);
    textValue = request?.kind === "input" ? (request.initialValue ?? "") : "";
  });

  $effect(() => {
    if (request && activeRequestId === request.id && !sheetOpen) respond(null);
  });

  function respond(value: string | boolean | null): void {
    if (!request) return;
    activeSessionState.respondToExtensionUi(request.id, value);
  }
</script>

<Sheet.Root bind:open={sheetOpen}>
  <Sheet.BottomContent class="max-h-[82dvh]">
    {#if request}
      <SheetHeader title={request.title} description="Pi extension request" />

      <div class="space-y-3 overflow-y-auto p-3">
        {#if request.kind === "confirm"}
          <p class="type-copy whitespace-pre-wrap text-[color:var(--color-fg)]">{request.message}</p>
          <div class="grid grid-cols-2 gap-2 pt-1">
            <Button type="button" variant="outline" onclick={() => respond(false)}>deny</Button>
            <Button type="button" onclick={() => respond(true)}>allow</Button>
          </div>
        {:else if request.kind === "select"}
          <div class="space-y-2">
            {#each request.options as option}
              <Button type="button" variant="outline" class="w-full justify-start" onclick={() => respond(option)}>{option}</Button>
            {/each}
          </div>
          <Button type="button" variant="ghost" class="w-full" onclick={() => respond(null)}>cancel</Button>
        {:else if request.kind === "input"}
          {#if request.multiline}
            <Textarea class="type-copy min-h-36" placeholder={request.placeholder ?? ""} bind:value={textValue} />
          {:else}
            <Input type="text" class="type-copy h-10" placeholder={request.placeholder ?? ""} bind:value={textValue} />
          {/if}
          <div class="grid grid-cols-2 gap-2 pt-1">
            <Button type="button" variant="outline" onclick={() => respond(null)}>cancel</Button>
            <Button type="button" onclick={() => respond(textValue)}>submit</Button>
          </div>
        {/if}
      </div>
    {/if}
  </Sheet.BottomContent>
</Sheet.Root>
