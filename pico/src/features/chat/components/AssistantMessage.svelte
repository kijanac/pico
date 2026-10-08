<script lang="ts">
  import { Check, Copy, GitBranch, Info, Loader2 } from "@lucide/svelte";
  import type { AssistantMessage } from "@pico/protocol";
  import { Button } from "@/shared/ui/button";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import * as Sheet from "@/shared/ui/sheet";
  import { formatCost, formatTokens, relativeTime } from "@/shared/lib/format";
  import StreamingMarkdown from "@/features/chat/components/StreamingMarkdown.svelte";
  import MessageInfoRow from "@/features/chat/components/MessageInfoRow.svelte";
  import AssistantErrorBanner from "@/features/chat/components/AssistantErrorBanner.svelte";
  import { navigateSessionTree } from "@/features/chat/api";
  import { hostIssueSummary } from "@/shared/lib/host-issues";
  import { runRpc } from "@/shared/lib/rpc-client";
  import { copyText as copyClipboardText } from "@/shared/mobile/clipboard";

  // endsTurn: the turn's final answer, which carries the turn's actions.
  let { msg, sessionId, endsTurn = false }: { msg: AssistantMessage; sessionId: string; endsTurn?: boolean } = $props();

  let copied = $state(false);
  let detailsOpen = $state(false);
  let branching = $state(false);
  let branchError = $state<string | null>(null);

  const showBanner = $derived(msg.stopReason === "error" || msg.stopReason === "aborted" || msg.stopReason === "length");
  const showActions = $derived(endsTurn && !msg.streaming && msg.text.length > 0);

  async function copyText(): Promise<void> {
    await copyClipboardText(msg.text);
    copied = true;
    window.setTimeout(() => {
      copied = false;
    }, 900);
  }

  async function branchFromHere(): Promise<void> {
    if (branching) return;
    branching = true;
    branchError = null;
    try {
      await runRpc(navigateSessionTree(sessionId, { entryId: msg.id }));
    } catch (error) {
      branchError = hostIssueSummary(error);
    } finally {
      branching = false;
    }
  }
</script>

<div class="type-message px-3 text-[color:var(--color-fg)]">
  {#if msg.text.length > 0}
    <StreamingMarkdown text={msg.text} done={!msg.streaming} />
  {/if}
  {#if msg.streaming}
    <span aria-hidden="true" class="ml-0.5 inline-block h-[1em] w-[0.4em] translate-y-[0.15em] animate-pulse motion-reduce:animate-none bg-[color:var(--color-accent)]"></span>
  {/if}

  {#if showBanner && msg.stopReason}
    <AssistantErrorBanner stopReason={msg.stopReason} errorMessage={msg.errorMessage} />
  {/if}

  {#if branchError}
    <div class="type-meta mt-1 text-[color:var(--color-danger)]">{branchError}</div>
  {/if}

  {#if showActions}
    <div class="mt-0.5 flex justify-start gap-1 pointer-coarse:gap-4 text-[color:var(--color-fg-faint)]">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={copied ? "Copied" : "Copy message"} title={copied ? "Copied" : "Copy message"} onclick={copyText}>
        {#if copied}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Branch from here" title="Branch from here" disabled={branching} onclick={branchFromHere}>
        {#if branching}<Loader2 class="size-3.5 animate-spin" />{:else}<GitBranch class="size-3.5" />{/if}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Message details" title="Message details" onclick={() => (detailsOpen = true)}>
        <Info class="size-3.5" />
      </Button>
    </div>
  {/if}
</div>

<Sheet.Root bind:open={detailsOpen}>
  <Sheet.BottomContent>
    <SheetHeader title="message details" />
    <div class="px-3 pb-3">
      <div class="type-meta rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
        <MessageInfoRow label="time" value={relativeTime(msg.at)} />
        {#if msg.usage}
          <MessageInfoRow label="input" value={formatTokens(msg.usage.input)} />
          <MessageInfoRow label="output" value={formatTokens(msg.usage.output)} />
          <MessageInfoRow label="cache read" value={formatTokens(msg.usage.cacheRead)} />
          <MessageInfoRow label="cache write" value={formatTokens(msg.usage.cacheWrite)} />
          <MessageInfoRow label="total" value={formatTokens(msg.usage.totalTokens)} />
          <MessageInfoRow label="cost" value={formatCost(msg.usage.cost.total)} />
        {:else}
          <div class="py-1 text-[color:var(--color-fg-muted)]">usage is not available for this message</div>
        {/if}
      </div>
    </div>
  </Sheet.BottomContent>
</Sheet.Root>

