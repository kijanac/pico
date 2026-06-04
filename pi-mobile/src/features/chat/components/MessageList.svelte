<script lang="ts">
  import { onMount, tick } from "svelte";
  import { ArrowDown } from "@lucide/svelte";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
  import UserMessageView from "@/features/chat/components/UserMessage.svelte";
  import AssistantMessageView from "@/features/chat/components/AssistantMessage.svelte";
  import ToolCallView from "@/features/chat/components/ToolCall.svelte";
  import PermissionGate from "@/features/chat/components/PermissionGate.svelte";
  import CompactionMessageView from "@/features/chat/components/CompactionMessage.svelte";

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

  onMount(() => {
    scrollToLatest("auto");
  });

  $effect(() => {
    const version = chatLogState.activityVersion;
    if (version === lastActivityVersion) return;
    lastActivityVersion = version;
    void tick().then(() => {
      if (stuckToBottom) scrollToLatest("auto");
      else hasNewActivity = true;
    });
  });
</script>

<div class="relative min-h-0 flex-1 overflow-hidden">
  <div bind:this={scroller} onscroll={onScroll} class="scroll-momentum h-full overflow-y-auto py-2" style="padding-bottom: 0.5rem">
    {#each chatLogState.entries as entry (entry.id)}
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
    {/each}
  </div>

  {#if !stuckToBottom}
    <button
      type="button"
      onpointerdown={(event) => event.preventDefault()}
      onclick={() => scrollToLatest()}
      class={`text-meta absolute right-3 z-30 flex items-center gap-1.5 rounded-full border px-3 py-1.5 shadow-lg backdrop-blur-md ${hasNewActivity ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-[color:var(--color-bg)] active:opacity-85" : "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]/95 text-[color:var(--color-fg)] active:bg-[color:var(--color-surface-2)]"}`}
      style="bottom: 0.75rem"
      aria-label={hasNewActivity ? "Scroll to new messages" : "Scroll to latest message"}
    >
      <ArrowDown class="size-3.5" />
      <span>{hasNewActivity ? "new" : "latest"}</span>
    </button>
  {/if}
</div>
