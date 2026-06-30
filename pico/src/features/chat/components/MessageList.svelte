<script lang="ts">
  import { onMount, tick } from "svelte";
  import { ArrowDown } from "@lucide/svelte";
  import type { LogEntry } from "@pico/protocol";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
  import UserMessageView from "@/features/chat/components/UserMessage.svelte";
  import AssistantMessageView from "@/features/chat/components/AssistantMessage.svelte";
  import ToolCallView from "@/features/chat/components/ToolCall.svelte";
  import CompactionMessageView from "@/features/chat/components/CompactionMessage.svelte";
  import AgentThinkingIndicator from "@/features/chat/components/AgentThinkingIndicator.svelte";
  import { getSessionLogBefore } from "@/features/chat/api";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { markSessionOpen } from "@/shared/lib/session-open-timing";
  import { runOnHost } from "@/shared/lib/rpc-client";
  import { Button } from "@/shared/ui/button";

  let { hostId, sessionId }: { hostId: string; sessionId: string } = $props();
  const timingId = $derived(`${hostId}:${sessionId}`);

  const STICK_THRESHOLD_PX = 64;
  const INITIAL_VISIBLE_ENTRIES = 120;
  const REVEAL_ENTRIES = 60;
  const LOAD_EARLIER_MARGIN_PX = 120;

  let scroller = $state<HTMLDivElement | null>(null);
  let topSentinel = $state<HTMLDivElement | null>(null);
  let bottomSentinel = $state<HTMLDivElement | null>(null);
  let stuckToBottom = $state(true);
  let hasNewActivity = $state(false);
  let visibleCount = $state(INITIAL_VISIBLE_ENTRIES);
  let pagingEnabled = $state(false);
  let loadingEarlier = false;
  let expectedEarlierEntryGrowth = 0;
  let lastEntryCount = $state(chatLogState.entries.length);
  let lastActivityVersion = $state(chatLogState.activityVersion);
  let lastThinkingIndicatorVisible = false;
  let firstRenderMarked = false;

  type DisplayRow =
    | { kind: "entry"; key: string; entry: LogEntry }
    | { kind: "thinking"; key: string };

  interface ScrollAnchor {
    entryId: string;
    top: number;
  }

  // Key agent rows by the slot after the previous entry so the thinking row
  // can turn into the first real agent row without a remove/add layout jolt.
  const agentSlotKey = (previous: LogEntry | undefined): string => `agent-slot:${previous?.id ?? "start"}`;

  const totalEntries = $derived(chatLogState.entries.length);
  const hasLocalEarlierEntries = $derived(visibleCount < totalEntries);
  const hasEarlierEntries = $derived(hasLocalEarlierEntries || chatLogState.hasMoreBefore);
  const visibleStartIndex = $derived(Math.max(0, totalEntries - visibleCount));
  const visibleEntries = $derived.by(() => chatLogState.entries.slice(visibleStartIndex));
  const latestEntry = $derived.by(() => chatLogState.entries[chatLogState.entries.length - 1]);

  function isDisplayableAssistant(entry: Extract<LogEntry, { kind: "assistant" }>): boolean {
    return entry.text.trim().length > 0 || entry.stopReason === "error" || entry.stopReason === "aborted" || entry.stopReason === "length" || Boolean(entry.errorMessage || entry.errorCode);
  }

  function isRenderableEntry(entry: LogEntry): boolean {
    return entry.kind !== "assistant" || isDisplayableAssistant(entry);
  }

  function isCurrentAgentOutput(entry: LogEntry | undefined): boolean {
    if (!entry) return false;
    if (entry.kind === "assistant") return isDisplayableAssistant(entry);
    if (entry.kind === "tool_call") return entry.status === "running";
    if (entry.kind === "compaction") return entry.status === "running";
    return false;
  }

  function previousRenderableEntryBefore(index: number): LogEntry | undefined {
    for (let i = index - 1; i >= 0; i -= 1) {
      const entry = chatLogState.entries[i];
      if (isRenderableEntry(entry)) return entry;
    }
    return undefined;
  }

  const latestEntryIsCurrentAgentOutput = $derived.by(() => isCurrentAgentOutput(latestEntry));
  const showThinkingIndicator = $derived(activeSessionState.status === "thinking" && !latestEntryIsCurrentAgentOutput);
  const displayRows = $derived.by(() => {
    const rows: DisplayRow[] = [];
    let previousRenderedEntry = previousRenderableEntryBefore(visibleStartIndex);

    for (const entry of visibleEntries) {
      if (!isRenderableEntry(entry)) continue;
      rows.push({
        kind: "entry",
        entry,
        key: entry.kind === "user" ? entry.id : agentSlotKey(previousRenderedEntry),
      });
      previousRenderedEntry = entry;
    }

    if (showThinkingIndicator) rows.push({ kind: "thinking", key: agentSlotKey(previousRenderedEntry) });
    return rows;
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

  function captureScrollAnchor(): ScrollAnchor | null {
    if (!scroller) return null;

    const scrollerRect = scroller.getBoundingClientRect();
    for (const row of Array.from(scroller.querySelectorAll<HTMLElement>("[data-log-entry-id]"))) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom <= scrollerRect.top + 1) continue;
      if (rect.top >= scrollerRect.bottom - 1) return null;

      const entryId = row.dataset.logEntryId;
      return entryId ? { entryId, top: rect.top - scrollerRect.top } : null;
    }
    return null;
  }

  function restoreScrollAnchor(anchor: ScrollAnchor | null): void {
    if (!scroller || !anchor) return;

    const row = Array.from(scroller.querySelectorAll<HTMLElement>("[data-log-entry-id]")).find(
      (candidate) => candidate.dataset.logEntryId === anchor.entryId,
    );
    if (!row) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const nextTop = row.getBoundingClientRect().top - scrollerRect.top;
    scroller.scrollTop += nextTop - anchor.top;
  }

  async function revealEarlierEntries(): Promise<void> {
    if (!scroller || loadingEarlier || !hasEarlierEntries) return;

    loadingEarlier = true;
    const anchor = captureScrollAnchor();

    try {
      if (hasLocalEarlierEntries) {
        visibleCount = Math.min(totalEntries, visibleCount + REVEAL_ENTRIES);
      } else {
        const beforeId = visibleEntries[0]?.id;
        if (!beforeId) return;
        const page = await runOnHost(hostId, getSessionLogBefore(sessionId, beforeId, REVEAL_ENTRIES));
        const prepended = chatLogState.prependEarlierEntries(hostId, sessionId, page);
        expectedEarlierEntryGrowth += prepended;
        visibleCount += prepended;
      }

      await tick();
      restoreScrollAnchor(anchor);
    } finally {
      loadingEarlier = false;
    }
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
      expectedEarlierEntryGrowth = 0;
    } else if (nextCount > lastEntryCount && !stuckToBottom) {
      const growth = nextCount - lastEntryCount;
      const appended = Math.max(0, growth - expectedEarlierEntryGrowth);
      expectedEarlierEntryGrowth = Math.max(0, expectedEarlierEntryGrowth - growth);
      visibleCount += appended;
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
      { root: scroller, rootMargin: `${LOAD_EARLIER_MARGIN_PX}px 0px 0px 0px` },
    );
    observer.observe(topSentinel);

    return () => observer.disconnect();
  });

  $effect(() => {
    if (chatLogState.entries.length > 0 && !firstRenderMarked) {
      firstRenderMarked = true;
      void tick().then(() => requestAnimationFrame(() => markSessionOpen(timingId, "first-render")));
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
    {#each displayRows as row (row.key)}
      <div class="msg-cv" data-log-entry-id={row.kind === "entry" ? row.entry.id : undefined}>
        {#if row.kind === "thinking"}
          <AgentThinkingIndicator />
        {:else if row.entry.kind === "user"}
          <UserMessageView msg={row.entry} {hostId} {sessionId} />
        {:else if row.entry.kind === "assistant"}
          <AssistantMessageView msg={row.entry} {hostId} {sessionId} />
        {:else if row.entry.kind === "tool_call"}
          <ToolCallView msg={row.entry} />
        {:else if row.entry.kind === "compaction"}
          <CompactionMessageView msg={row.entry} />
        {/if}
      </div>
    {/each}
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
