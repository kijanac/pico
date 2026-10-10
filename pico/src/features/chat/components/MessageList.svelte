<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { ArrowDown } from "@lucide/svelte";
  import type { CompactionEntry, ImageContent, LogEntry, UserMessage } from "@pico/protocol";
  import { chatLogState, type OutboxItem } from "@/features/chat/model/chat-log.state.svelte";
  import UserMessageView from "@/features/chat/components/UserMessage.svelte";
  import AssistantMessageView from "@/features/chat/components/AssistantMessage.svelte";
  import ToolCallView from "@/features/chat/components/ToolCall.svelte";
  import CompactionMessageView from "@/features/chat/components/CompactionMessage.svelte";
  import NoteMessageView from "@/features/chat/components/NoteMessage.svelte";
  import StepsLine from "@/features/chat/components/StepsLine.svelte";
  import { gatherSteps, groupKeyOf, isStep, summarizeSteps, type StepsSummary } from "@/features/chat/model/steps";
  import AgentThinkingIndicator from "@/features/chat/components/AgentThinkingIndicator.svelte";
  import { getSessionHistory } from "@/features/chat/api";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { markSessionOpen } from "@/shared/lib/session-open-timing";
  import { runRpc } from "@/shared/lib/rpc-client";
  import { Button } from "@/shared/ui/button";

  let { sessionId, bottomInset = 0 }: { sessionId: string; bottomInset?: number } = $props();
  const timingId = $derived(sessionId);

  const STICK_THRESHOLD_PX = 64;
  const INITIAL_VISIBLE_ENTRIES = 120;
  const REVEAL_ENTRIES = 60;
  const LOAD_EARLIER_SCREENS = 1.5;

  let scroller = $state<HTMLDivElement | null>(null);
  let topSentinel = $state<HTMLDivElement | null>(null);
  let rowList = $state<HTMLDivElement | null>(null);
  let stuckToBottom = $state(true);
  let hasNewActivity = $state(false);
  let visibleCount = $state(INITIAL_VISIBLE_ENTRIES);
  let pagingEnabled = $state(false);
  let loadingEarlier = false;
  let earlierFailed = $state(false);
  let expectedEarlierEntryGrowth = 0;
  let lastEntryCount = $state(chatLogState.entries.length);
  let lastActivityVersion = $state(chatLogState.activityVersion);
  let lastThinkingIndicatorVisible = false;
  let firstRenderMarked = false;
  let lastBottomInset = $state(0);

  type UserRow = {
    kind: "user";
    key: string;
    entry?: UserMessage;
    text: string;
    images?: readonly ImageContent[];
    queued?: boolean;
    outbox?: OutboxItem;
  };
  type StepsRow = { kind: "steps"; key: string; summary: StepsSummary; inProgress: boolean; durationMs?: number; open: boolean };
  type DisplayRow = { kind: "entry"; key: string; entry: LogEntry } | { kind: "thinking"; key: string } | UserRow | StepsRow;

  const compactingRow: CompactionEntry = { kind: "compaction", id: "live:compaction", at: 0, status: "running" };

  interface ScrollAnchor {
    entryId: string;
    top: number;
  }

  const agentSlotKey = (previous: LogEntry | undefined): string => `agent-slot:${previous?.id ?? "start"}`;

  const totalEntries = $derived(chatLogState.entries.length);
  const hasLocalEarlierEntries = $derived(visibleCount < totalEntries);
  const hasEarlierEntries = $derived(hasLocalEarlierEntries || chatLogState.more !== undefined);
  const visibleStartIndex = $derived(Math.max(0, totalEntries - visibleCount));
  const unsavedEntries = $derived.by(() => [
    ...(chatLogState.streaming ? [chatLogState.streaming] : []),
    ...chatLogState.streamingCalls,
    ...(chatLogState.live.compacting ? [compactingRow] : []),
  ]);
  const visibleEntries = $derived.by(() => [...chatLogState.entries.slice(visibleStartIndex), ...unsavedEntries]);
  const latestEntry = $derived.by(() => unsavedEntries.at(-1) ?? chatLogState.entries.at(-1));

  function isDisplayableAssistant(entry: Extract<LogEntry, { kind: "assistant" }>): boolean {
    return entry.text.trim().length > 0 || entry.stopReason === "error" || entry.stopReason === "aborted" || entry.stopReason === "length" || Boolean(entry.errorMessage);
  }

  function isRenderableEntry(entry: LogEntry): boolean {
    return entry.kind !== "assistant" || isDisplayableAssistant(entry);
  }

  function isCurrentAgentOutput(entry: LogEntry | undefined): boolean {
    if (!entry) return false;
    if (entry.kind === "assistant") return isDisplayableAssistant(entry);
    if (entry.kind === "tool_call") return entry.status === "running" || entry.status === "pending";
    if (entry.kind === "compaction") return entry.status === "running";
    return false;
  }

  const turnActionRows = $derived.by(() => {
    const rows = new Set<string>();
    let lastTextOfTurn: string | undefined;
    for (const entry of visibleEntries) {
      if (entry.kind === "user") lastTextOfTurn = undefined;
      if (entry.kind !== "assistant" || entry.streaming) continue;
      if (entry.text.length > 0) lastTextOfTurn = entry.id;
      if (isStep(entry)) continue;
      if (lastTextOfTurn) rows.add(lastTextOfTurn);
      lastTextOfTurn = undefined;
    }
    return rows;
  });

  const latestEntryIsCurrentAgentOutput = $derived.by(() => isCurrentAgentOutput(latestEntry));
  const showThinkingIndicator = $derived(activeSessionState.status === "thinking" && !latestEntryIsCurrentAgentOutput);
  let previousRows = new Map<string, DisplayRow>();
  const heldOpen = new Set<string>();
  let unanswered = new Set<string>();
  // svelte-ignore state_referenced_locally
  const readingAtOpen = chatLogState.reading(sessionId);
  if (readingAtOpen?.anchor && !readingAtOpen.following) {
    const steps = groupKeyOf(chatLogState.entries, readingAtOpen.anchor.entryId);
    if (steps) heldOpen.add(steps);
  }
  const isStreamingReply = (entry: LogEntry) => entry.kind === "assistant" && entry.streaming === true;

  const uniqueByKey = (rows: DisplayRow[]) => {
    const keys = new Set<string>();
    return rows.filter((row) => !keys.has(row.key) && keys.add(row.key));
  };

  const displayRows = $derived.by(() => {
    const rows: DisplayRow[] = [];
    const nextRows = new Map<string, DisplayRow>();
    const nextUnanswered = new Set<string>();
    const all = [...chatLogState.entries, ...unsavedEntries];
    let index = 0;
    let previousRenderedEntry: LogEntry | undefined;

    const addEntry = (entry: LogEntry, shown: boolean) => {
      const inWindow = index++ >= visibleStartIndex;
      if (!isRenderableEntry(entry)) return;
      if (inWindow) {
        const key =
          entry.kind === "user" ? (entry.cid ?? entry.id) : entry.kind === "tool_call" ? `tool:${entry.id}` : agentSlotKey(previousRenderedEntry);
        const cached = previousRows.get(key);
        const row: DisplayRow =
          cached && "entry" in cached && cached.entry === entry
            ? cached
            : entry.kind === "user"
              ? { kind: "user", key, entry, text: entry.text, images: entry.images }
              : { kind: "entry", entry, key };
        nextRows.set(key, row);
        if (shown) rows.push(row);
      }
      previousRenderedEntry = entry;
    };

    for (const segment of gatherSteps(all)) {
      if (segment.kind === "entry") {
        addEntry(segment.entry, true);
        continue;
      }
      const { key, answeredInWords, entries } = segment;
      if (!answeredInWords) nextUnanswered.add(key);
      else if (unanswered.has(key) && !untrack(() => stuckToBottom)) heldOpen.add(key);
      const open = chatLogState.toolOpen(key) ?? (!answeredInWords || heldOpen.has(key));
      const end = index + entries.length;
      if (end > visibleStartIndex) {
        const inProgress = !answeredInWords && chatLogState.live.running && end === all.length;
        rows.push({ kind: "steps", key, summary: summarizeSteps(entries), inProgress, durationMs: segment.durationMs, open });
      }
      for (const entry of entries) addEntry(entry, open || isStreamingReply(entry));
    }
    previousRows = nextRows;
    unanswered = nextUnanswered;

    for (const item of chatLogState.outbox) rows.push({ kind: "user", key: item.cid, text: item.text, images: item.images, outbox: item });
    if (showThinkingIndicator) rows.push({ kind: "thinking", key: agentSlotKey(previousRenderedEntry) });
    chatLogState.live.queue.forEach((item, index) =>
      rows.push({ kind: "user", key: item.cid ?? `queued:${index}:${item.text}`, text: item.text, images: chatLogState.images(item.cid), queued: true }),
    );
    return uniqueByKey(rows);
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

  let settleRaf: number | null = null;

  async function scrollToLatest(): Promise<void> {
    if (!scroller) return;
    await tick();

    if (settleRaf !== null) cancelAnimationFrame(settleRaf);
    let remainingFrames = 5;
    const step = () => {
      settleRaf = null;
      if (remainingFrames < 5 && !stuckToBottom) return;
      pinToBottom();
      remainingFrames -= 1;
      if (remainingFrames > 0) settleRaf = requestAnimationFrame(step);
    };
    step();
  }

  let rowsArrive = false;
  const arrive = (node: HTMLElement) => {
    if (rowsArrive && !loadingEarlier) node.classList.add(node.hasAttribute("data-sent") ? "msg-sent" : "msg-enter");
  };
  $effect(() => {
    if (chatLogState.synced) void tick().then(() => (rowsArrive = true));
  });

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
        const before = chatLogState.more;
        if (!before) return;
        const page = await runRpc(getSessionHistory(sessionId, before, REVEAL_ENTRIES));
        const prepended = chatLogState.prependHistory(sessionId, page);
        expectedEarlierEntryGrowth += prepended;
        visibleCount += prepended;
      }

      await tick();
      restoreScrollAnchor(anchor);
    } catch {
      earlierFailed = true;
      return;
    } finally {
      loadingEarlier = false;
    }
    if (withinReachOfTop()) void revealEarlierEntries();
  }

  const earlierLead = () => (scroller?.clientHeight ?? 0) * LOAD_EARLIER_SCREENS;
  const withinReachOfTop = () => scroller !== null && hasEarlierEntries && !earlierFailed && scroller.scrollTop < earlierLead();

  function toggleSteps(row: StepsRow): void {
    const opening = !row.open;
    if (opening) stuckToBottom = false;
    chatLogState.setToolOpen(row.key, opening);
  }

  function onScroll(): void {
    const stuck = distanceFromBottom() < STICK_THRESHOLD_PX;
    stuckToBottom = stuck;
    if (stuck) hasNewActivity = false;
    noteReadingPlace();
    if (withinReachOfTop()) void revealEarlierEntries();
  }

  let readingAnchor: ScrollAnchor | null = null;
  let readingTimer: ReturnType<typeof setTimeout> | undefined;

  function noteReadingPlace(): void {
    clearTimeout(readingTimer);
    readingTimer = setTimeout(() => (readingAnchor = captureScrollAnchor()), 150);
  }

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
    const reading = chatLogState.reading(sessionId);
    const returning = reading && !reading.following && reading.anchor;
    if (returning) {
      visibleCount = Math.max(visibleCount, reading.visibleCount);
      stuckToBottom = false;
    }
    void (async () => {
      if (returning) {
        await tick();
        restoreScrollAnchor(reading.anchor);
        readingAnchor = reading.anchor;
        stuckToBottom = distanceFromBottom() < STICK_THRESHOLD_PX;
      } else {
        await scrollToLatest();
      }
      requestAnimationFrame(() => {
        pagingEnabled = true;
      });
    })();

    let lastScrollerHeight = scroller?.clientHeight ?? 0;
    const keyboardOrComposerObserver = new ResizeObserver(() => {
      if (!scroller) return;

      const nextHeight = scroller.clientHeight;
      const lostHeight = Math.max(0, lastScrollerHeight - nextHeight);
      lastScrollerHeight = nextHeight;

      if (stuckToBottom || distanceFromBottom() <= STICK_THRESHOLD_PX + lostHeight) {
        void scrollToLatest();
      }
    });
    if (scroller) keyboardOrComposerObserver.observe(scroller);

    const growthObserver = new ResizeObserver(() => {
      if (stuckToBottom) scheduleScrollSync();
    });
    if (rowList) growthObserver.observe(rowList);

    return () => {
      clearTimeout(readingTimer);
      chatLogState.saveReading(sessionId, { anchor: readingAnchor, visibleCount, following: stuckToBottom });
      keyboardOrComposerObserver.disconnect();
      growthObserver.disconnect();
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
        if (earlierFailed) return;
        if (entries.some((entry) => entry.isIntersecting)) void revealEarlierEntries();
      },
      { root: scroller, rootMargin: `${Math.round(earlierLead())}px 0px 0px 0px` },
    );
    observer.observe(topSentinel);

    return () => observer.disconnect();
  });

  $effect(() => {
    const nextBottomInset = bottomInset;
    if (nextBottomInset !== lastBottomInset && stuckToBottom) void scrollToLatest();
    lastBottomInset = nextBottomInset;
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

<div class="relative h-full min-h-0 flex-1 overflow-hidden">
  <div bind:this={scroller} onscroll={onScroll} class="scroll-momentum h-full overflow-y-auto py-2" style={`padding-bottom: calc(${bottomInset}px + 0.5rem)`}>
    {#if hasEarlierEntries}
      <div bind:this={topSentinel} class="h-px" aria-hidden="true"></div>
    {/if}
    {#if earlierFailed}
      <div class="column type-meta flex items-center justify-center gap-2 px-3 py-2 text-[color:var(--color-fg-muted)]">
        earlier messages didn't load
        <button type="button" class="underline active:opacity-70" onclick={() => { earlierFailed = false; void revealEarlierEntries(); }}>retry</button>
      </div>
    {/if}
    <div bind:this={rowList}>
      {#each displayRows as row, index (row.key)}
        <div class={["column", index > 0 && (row.kind === "user" ? "pt-turn" : "pt-step")]} data-log-entry-id={row.kind === "entry" || row.kind === "user" ? row.entry?.id : undefined} data-sent={row.kind === "user" && (row.outbox || row.queued) ? "" : undefined} {@attach arrive}>
          {#if row.kind === "thinking"}
            <AgentThinkingIndicator />
          {:else if row.kind === "steps"}
            <StepsLine summary={row.summary} inProgress={row.inProgress} durationMs={row.durationMs} open={row.open} onToggle={() => toggleSteps(row)} />
          {:else if row.kind === "user"}
            <UserMessageView text={row.text} images={row.images} queued={row.queued} outbox={row.outbox} {sessionId} />
          {:else if row.entry.kind === "assistant"}
            <AssistantMessageView msg={row.entry} {sessionId} endsTurn={turnActionRows.has(row.entry.id)} />
          {:else if row.entry.kind === "tool_call"}
            <ToolCallView msg={row.entry} />
          {:else if row.entry.kind === "compaction"}
            <CompactionMessageView msg={row.entry} />
          {:else if row.entry.kind === "note"}
            <NoteMessageView msg={row.entry} />
          {/if}
        </div>
      {/each}
    </div>
  </div>

  {#if !stuckToBottom}
    <Button
      type="button"
      variant={hasNewActivity ? "default" : "outline"}
      size="sm"
      onpointerdown={(event) => event.preventDefault()}
      onclick={() => void scrollToLatest()}
      class={`type-meta absolute right-[max(0.75rem,calc((100%_-_var(--container-column))/2_+_0.75rem))] z-30 h-auto rounded-full px-3 py-1.5 shadow-lg transition-colors ${hasNewActivity ? "active:opacity-85" : "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]/95 text-[color:var(--color-fg)] active:bg-[color:var(--color-surface-2)]"}`}
      style={`bottom: calc(${bottomInset}px + 0.75rem)`}
      aria-label={hasNewActivity ? "Scroll to new messages" : "Scroll to latest message"}
    >
      <ArrowDown class="size-3.5" />
      <span>{hasNewActivity ? "new" : "latest"}</span>
    </Button>
  {/if}
</div>
