<script lang="ts">
  import { onMount, tick } from "svelte";
  import { ArrowDown } from "@lucide/svelte";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
  import UserMessageView from "@/features/chat/components/UserMessage.svelte";
  import AssistantMessageView from "@/features/chat/components/AssistantMessage.svelte";
  import ToolCallView from "@/features/chat/components/ToolCall.svelte";
  import CompactionMessageView from "@/features/chat/components/CompactionMessage.svelte";
  import AgentThinkingIndicator from "@/features/chat/components/AgentThinkingIndicator.svelte";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { markSessionOpen } from "@/shared/lib/session-open-timing";
  import { Button } from "@/shared/ui/button";

  let { sessionId }: { sessionId: string } = $props();

  const STICK_THRESHOLD_PX = 64;
  const INITIAL_VISIBLE_ENTRIES = 120;
  const REVEAL_ENTRIES = 120;

  let scroller = $state<HTMLDivElement | null>(null);
  let topSentinel = $state<HTMLDivElement | null>(null);
  let bottomSentinel = $state<HTMLDivElement | null>(null);
  let stuckToBottom = $state(true);
  let hasNewActivity = $state(false);
  let visibleCount = $state(INITIAL_VISIBLE_ENTRIES);
  let pagingEnabled = $state(false);
  let loadingEarlier = false;
  let lastEntryCount = $state(chatLogState.entries.length);
  let lastActivityVersion = $state(chatLogState.activityVersion);
  let lastThinkingIndicatorVisible = false;
  let firstRenderMarked = false;

  const totalEntries = $derived(chatLogState.entries.length);
  const hasEarlierEntries = $derived(visibleCount < totalEntries);
  const visibleEntries = $derived.by(() => chatLogState.entries.slice(Math.max(0, totalEntries - visibleCount)));
  const latestEntry = $derived.by(() => chatLogState.entries[chatLogState.entries.length - 1]);
  const showThinkingIndicator = $derived.by(() => {
    if (activeSessionState.status !== "thinking") return false;

    const latest = latestEntry;
    if (!latest) return true;
    if (latest.kind === "assistant") return false;
    if (latest.kind === "tool_call" && latest.status === "running") return false;
    if (latest.kind === "compaction" && latest.status === "running") return false;
    return true;
  });

  function distanceFromBottom(): number {
    if (!scroller) return 0;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  }

  function pinToBottom(): void {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    stuckToBottom = true;
    hasNewActivity = false;
  }

  function applyScrollToLatest(behavior: ScrollBehavior): void {
    if (!scroller) return;
    bottomSentinel?.scrollIntoView({ block: "end", behavior });
    pinToBottom();
  }

  let settleRaf: number | null = null;

  async function scrollToLatest(behavior: ScrollBehavior = "smooth"): Promise<void> {
    if (!scroller) return;
    await tick();

    if (settleRaf !== null) cancelAnimationFrame(settleRaf);
    let remainingFrames = 5;
    const step = () => {
      applyScrollToLatest(remainingFrames === 5 ? behavior : "auto");
      remainingFrames -= 1;
      settleRaf = remainingFrames > 0 ? requestAnimationFrame(step) : null;
    };
    step();
  }

  async function revealEarlierEntries(): Promise<void> {
    if (!scroller || loadingEarlier || visibleCount >= totalEntries) return;

    loadingEarlier = true;
    const beforeHeight = scroller.scrollHeight;
    const beforeTop = scroller.scrollTop;
    visibleCount = Math.min(totalEntries, visibleCount + REVEAL_ENTRIES);
    await tick();
    scroller.scrollTop = beforeTop + (scroller.scrollHeight - beforeHeight);
    loadingEarlier = false;
  }

  function onScroll(): void {
    const stuck = distanceFromBottom() < STICK_THRESHOLD_PX;
    stuckToBottom = stuck;
    if (stuck) hasNewActivity = false;
  }

  // Streamed deltas should gently preserve the bottom lock, not run the
  // multi-frame settle path used for keyboard/composer resize.
  let scrollRaf: number | null = null;

  function scheduleScrollSync(): void {
    if (scrollRaf !== null) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      if (stuckToBottom) pinToBottom();
      else hasNewActivity = true;
    });
  }

  onMount(() => {
    void (async () => {
      await scrollToLatest("auto");
      requestAnimationFrame(() => {
        pagingEnabled = true;
      });
    })();

    let lastScrollerHeight = scroller?.clientHeight ?? 0;
    const resizeObserver = new ResizeObserver(() => {
      if (!scroller) return;

      const nextHeight = scroller.clientHeight;
      const lostHeight = Math.max(0, lastScrollerHeight - nextHeight);
      lastScrollerHeight = nextHeight;

      // When the keyboard/composer changes height, keep the latest message pinned
      // only if the user was already following the bottom of the chat.
      if (stuckToBottom || distanceFromBottom() <= STICK_THRESHOLD_PX + lostHeight) {
        void scrollToLatest("auto");
      }
    });
    if (scroller) resizeObserver.observe(scroller);

    return () => {
      resizeObserver.disconnect();
      if (scrollRaf !== null) cancelAnimationFrame(scrollRaf);
      if (settleRaf !== null) cancelAnimationFrame(settleRaf);
    };
  });

  $effect(() => {
    const nextCount = totalEntries;
    if (nextCount < lastEntryCount) {
      visibleCount = INITIAL_VISIBLE_ENTRIES;
    } else if (nextCount > lastEntryCount && !stuckToBottom) {
      visibleCount += nextCount - lastEntryCount;
    }
    lastEntryCount = nextCount;
  });

  $effect(() => {
    if (!pagingEnabled || !scroller || !topSentinel || !hasEarlierEntries) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (stuckToBottom) return;
        if (entries.some((entry) => entry.isIntersecting)) void revealEarlierEntries();
      },
      { root: scroller, rootMargin: "800px 0px 0px 0px" },
    );
    observer.observe(topSentinel);

    return () => observer.disconnect();
  });

  $effect(() => {
    if (chatLogState.entries.length > 0 && !firstRenderMarked) {
      firstRenderMarked = true;
      void tick().then(() => requestAnimationFrame(() => markSessionOpen(sessionId, "first-render")));
    }
  });

  $effect(() => {
    const version = chatLogState.activityVersion;
    const indicatorVisible = showThinkingIndicator;
    const logChanged = version !== lastActivityVersion;
    const indicatorAppeared = indicatorVisible && !lastThinkingIndicatorVisible;

    lastActivityVersion = version;
    lastThinkingIndicatorVisible = indicatorVisible;

    if (logChanged || indicatorAppeared) scheduleScrollSync();
  });
</script>

<div class="relative min-h-0 flex-1 overflow-hidden">
  <div bind:this={scroller} onscroll={onScroll} class="scroll-momentum h-full overflow-y-auto py-2" style="padding-bottom: 0.5rem">
    {#if hasEarlierEntries}
      <div bind:this={topSentinel} class="h-px" aria-hidden="true"></div>
    {/if}
    {#each visibleEntries as entry (entry.id)}
      <div class="msg-cv">
        {#if entry.kind === "user"}
          <UserMessageView msg={entry} {sessionId} />
        {:else if entry.kind === "assistant"}
          <AssistantMessageView msg={entry} {sessionId} />
        {:else if entry.kind === "tool_call"}
          <ToolCallView msg={entry} />
        {:else if entry.kind === "compaction"}
          <CompactionMessageView msg={entry} />
        {/if}
      </div>
    {/each}
    {#if showThinkingIndicator}
      <div class="msg-cv">
        <AgentThinkingIndicator />
      </div>
    {/if}
    <div bind:this={bottomSentinel} aria-hidden="true"></div>
  </div>

  {#if !stuckToBottom}
    <Button
      type="button"
      variant={hasNewActivity ? "default" : "outline"}
      size="sm"
      onpointerdown={(event) => event.preventDefault()}
      onclick={() => void scrollToLatest("auto")}
      class={`type-meta absolute right-3 z-30 h-auto rounded-full px-3 py-1.5 shadow-lg backdrop-blur-md ${hasNewActivity ? "active:opacity-85" : "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]/95 text-[color:var(--color-fg)] active:bg-[color:var(--color-surface-2)]"}`}
      style="bottom: 0.75rem"
      aria-label={hasNewActivity ? "Scroll to new messages" : "Scroll to latest message"}
    >
      <ArrowDown class="size-3.5" />
      <span>{hasNewActivity ? "new" : "latest"}</span>
    </Button>
  {/if}
</div>
