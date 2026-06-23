<script lang="ts">
  import { Check, X } from "@lucide/svelte";
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

<!--
  Pass-through render: pi's ctx.ui only ever hands us a title/message string plus
  flat option strings, so we can't structurally separate a command from prose or
  know which option is destructive. We bring the old permission card's *feel* —
  the detail in a monospace, whitespace-preserving block so a command pasted into
  the prompt reads like code — without inventing any permission-specific type.
  `confirm` is the one exception we can style: it's structurally binary, so ✓ = true
  (accent) / ✕ = false (outline) is a fixed mapping, not a guess.
-->
{#snippet detailBlock(text: string)}
  <pre
    class="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] px-3 py-2.5 type-code leading-relaxed text-[color:var(--color-fg)]">{text}</pre>
{/snippet}

<Sheet.Root bind:open={sheetOpen}>
  <Sheet.BottomContent class="max-h-[82dvh]">
    {#if request}
      {#if request.kind === "confirm"}
        <SheetHeader title={request.title} />
        <div class="space-y-3 overflow-y-auto p-3">
          {#if request.message.trim()}
            {@render detailBlock(request.message)}
          {/if}
          <div class="grid grid-cols-2 gap-2 pt-1">
            <Button type="button" variant="outline" aria-label="No" onclick={() => respond(false)}>
              <X class="size-4" />
            </Button>
            <Button type="button" aria-label="Yes" onclick={() => respond(true)}>
              <Check class="size-4" />
            </Button>
          </div>
        </div>
      {:else if request.kind === "select"}
        <!-- No header: select's single `title` carries the whole ask, so it lives in
             the detail block. pt-8 clears the sheet's drag handle + close button. -->
        <div class="space-y-3 overflow-y-auto p-3 pt-8">
          {@render detailBlock(request.title)}
          <div class="space-y-2 pt-1">
            {#each request.options as option}
              <Button
                type="button"
                variant="outline"
                class="h-auto w-full justify-start whitespace-normal py-2.5 text-left"
                onclick={() => respond(option)}>{option}</Button
              >
            {/each}
          </div>
          <Button type="button" variant="ghost" class="w-full" onclick={() => respond(null)}>cancel</Button>
        </div>
      {:else if request.kind === "input"}
        <SheetHeader title={request.title} />
        <div class="space-y-3 overflow-y-auto p-3">
          {#if request.multiline}
            <Textarea class="type-copy min-h-36" placeholder={request.placeholder ?? ""} bind:value={textValue} />
          {:else}
            <Input type="text" class="type-copy h-10" placeholder={request.placeholder ?? ""} bind:value={textValue} />
          {/if}
          <div class="grid grid-cols-2 gap-2 pt-1">
            <Button type="button" variant="outline" onclick={() => respond(null)}>cancel</Button>
            <Button type="button" onclick={() => respond(textValue)}>submit</Button>
          </div>
        </div>
      {/if}
    {/if}
  </Sheet.BottomContent>
</Sheet.Root>
