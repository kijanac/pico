<script lang="ts">
  import { Check, X } from "@lucide/svelte";
  import * as Sheet from "@/shared/ui/sheet";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import { Button } from "@/shared/ui/button";
  import { Input } from "@/shared/ui/input";
  import { Textarea } from "@/shared/ui/textarea";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
  import { shortFailureText } from "@/shared/lib/host-issues";

  let textValue = $state("");
  let sheetOpen = $state(false);
  let activeRequestId = $state<string | null>(null);
  const request = $derived(chatLogState.live.ui[0]);

  let shown = $state<typeof request>();

  $effect(() => {
    const nextId = request?.id ?? null;
    if (nextId === activeRequestId) return;
    activeRequestId = nextId;
    sheetOpen = Boolean(request);
    if (!request) return;
    shown = request;
    textValue = request.kind === "input" ? (request.initialValue ?? "") : "";
  });

  $effect(() => {
    if (request && activeRequestId === request.id && !sheetOpen) respond(null);
  });

  let answering = $state(false);
  let answerError = $state<string | null>(null);

  async function respond(value: string | boolean | null): Promise<void> {
    if (!request || answering) return;
    answering = true;
    answerError = null;
    try {
      await activeSessionState.respondToExtensionUi(request.id, value);
    } catch (error) {
      answerError = `not sent · ${shortFailureText(error)}`;
      sheetOpen = true;
    } finally {
      answering = false;
    }
  }
</script>

{#snippet detailBlock(text: string)}
  <pre
    class="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-code-bg)] px-3 py-2.5 type-code leading-relaxed text-[color:var(--color-code-fg)]">{text}</pre>
{/snippet}

<Sheet.Root bind:open={sheetOpen}>
  <Sheet.BottomContent class="[--sheet-max-height:82dvh]">
    {#if answerError}
      <p class="type-meta px-3 pt-2 text-[color:var(--color-danger)]" role="alert">{answerError}</p>
    {/if}
    {#if shown}
      {#if shown.kind === "confirm"}
        <SheetHeader title={shown.title} />
        <div class="space-y-3 overflow-y-auto p-3">
          {#if shown.message.trim()}
            {@render detailBlock(shown.message)}
          {/if}
          <div class="grid grid-cols-2 gap-2 pt-1">
            <Button type="button" variant="outline" aria-label="No" disabled={answering} onclick={() => respond(false)}>
              <X class="size-4" />
            </Button>
            <Button type="button" aria-label="Yes" disabled={answering} onclick={() => respond(true)}>
              <Check class="size-4" />
            </Button>
          </div>
        </div>
      {:else if shown.kind === "select"}
        <div class="space-y-3 overflow-y-auto p-3 pt-8">
          {@render detailBlock(shown.title)}
          <div class="space-y-2 pt-1">
            {#each shown.options as option}
              <Button
                type="button"
                variant="outline"
                class="h-auto w-full justify-start whitespace-normal py-2.5 text-left"
                disabled={answering}
                onclick={() => respond(option)}>{option}</Button
              >
            {/each}
          </div>
          <Button type="button" variant="ghost" class="w-full" disabled={answering} onclick={() => respond(null)}>cancel</Button>
        </div>
      {:else if shown.kind === "input"}
        <SheetHeader title={shown.title} />
        <div class="space-y-3 overflow-y-auto p-3">
          {#if shown.multiline}
            <Textarea class="type-copy min-h-36" placeholder={shown.placeholder ?? ""} bind:value={textValue} />
          {:else}
            <Input type="text" class="type-copy h-10" placeholder={shown.placeholder ?? ""} bind:value={textValue} />
          {/if}
          <div class="grid grid-cols-2 gap-2 pt-1">
            <Button type="button" variant="outline" disabled={answering} onclick={() => respond(null)}>cancel</Button>
            <Button type="button" disabled={answering} onclick={() => respond(textValue)}>submit</Button>
          </div>
        </div>
      {/if}
    {/if}
  </Sheet.BottomContent>
</Sheet.Root>
