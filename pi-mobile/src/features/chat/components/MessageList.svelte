<script lang="ts">
  import { onMount } from "svelte";
  import { ArrowDown } from "@lucide/svelte";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
  import UserMessageView from "@/features/chat/components/UserMessage.svelte";
  import AssistantMessageView from "@/features/chat/components/AssistantMessage.svelte";
  import ToolCallView from "@/features/chat/components/ToolCall.svelte";
  import PermissionGate from "@/features/chat/components/PermissionGate.svelte";
  import CompactionMessageView from "@/features/chat/components/CompactionMessage.svelte";
  import { Button } from "@/shared/ui/button";

  let { sessionId }: { sessionId: string } = $props();

  const STICK_THRESHOLD_PX = 64;

  let scroller = $state<HTMLDivElement | null>(null);
  let stuckToBottom = $state(true);
  let hasNewActivity = $state(false);
  let lastActivityVersion = $state(chatLogState.activityVersion);

  function distanceFromBottom(): number {
    if (!scroller) return 0;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  }

  function scrollToLatest(behavior: ScrollBehavior = "smooth"): void {
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    stuckToBottom = true;
    hasNewActivity = false;
  }

  function onScroll(): void {
    const stuck = distanceFromBottom() < STICK_THRESHOLD_PX;
    stuckToBottom = stuck;
    if (stuck) hasNewActivity = false;
  }

  // Coalesce follow-scrolls into one rAF per frame: scrollTo forces layout,
  // so doing it per activity bump during streaming costs a reflow per chunk.
  let scrollRaf: number | null = null;

  function scheduleScrollSync(): void {
    if (scrollRaf !== null) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      if (stuckToBottom) scrollToLatest("auto");
      else hasNewActivity = true;
    });
  }

  onMount(() => {
    scrollToLatest("auto");
    return () => {
      if (scrollRaf !== null) cancelAnimationFrame(scrollRaf);
    };
  });

  $effect(() => {
    const version = chatLogState.activityVersion;
    if (version === lastActivityVersion) return;
    lastActivityVersion = version;
    scheduleScrollSync();
  });
</script>

<div class="relative min-h-0 flex-1 overflow-hidden">
  <div bind:this={scroller} onscroll={onScroll} class="scroll-momentum h-full overflow-y-auto py-2" style="padding-bottom: 0.5rem">
    {#each chatLogState.entries as entry (entry.id)}
      <div class="msg-cv">
        {#if entry.kind === "user"}
          <UserMessageView msg={entry} />
        {:else if entry.kind === "assistant"}
          <AssistantMessageView msg={entry} {sessionId} />
        {:else if entry.kind === "tool_call"}
          <ToolCallView msg={entry} />
        {:else if entry.kind === "permission"}
          <PermissionGate req={entry} />
        {:else if entry.kind === "compaction"}
          <CompactionMessageView msg={entry} />
        {/if}
      </div>
    {/each}
  </div>

  {#if !stuckToBottom}
    <Button
      type="button"
      variant={hasNewActivity ? "default" : "outline"}
      size="sm"
      onpointerdown={(event) => event.preventDefault()}
      onclick={() => scrollToLatest()}
      class={`type-meta absolute right-3 z-30 h-auto rounded-full px-3 py-1.5 shadow-lg backdrop-blur-md ${hasNewActivity ? "active:opacity-85" : "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]/95 text-[color:var(--color-fg)] active:bg-[color:var(--color-surface-2)]"}`}
      style="bottom: 0.75rem"
      aria-label={hasNewActivity ? "Scroll to new messages" : "Scroll to latest message"}
    >
      <ArrowDown class="size-3.5" />
      <span>{hasNewActivity ? "new" : "latest"}</span>
    </Button>
  {/if}
</div>
