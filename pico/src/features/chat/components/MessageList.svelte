<script lang="ts">
  import { onMount, tick } from "svelte";
  import { ArrowDown } from "@lucide/svelte";
  import type { CompactionEntry, ImageContent, LogEntry, UserMessage } from "@pico/protocol";
  import { chatLogState, type OutboxItem } from "@/features/chat/model/chat-log.state.svelte";
  import UserMessageView from "@/features/chat/components/UserMessage.svelte";
  import AssistantMessageView from "@/features/chat/components/AssistantMessage.svelte";
  import ToolCallView from "@/features/chat/components/ToolCall.svelte";
  import CompactionMessageView from "@/features/chat/components/CompactionMessage.svelte";
  import NoteMessageView from "@/features/chat/components/NoteMessage.svelte";
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
  // Earlier history is fetched this many screens before the reader reaches
  // it, so it arrives in time over a phone connection.
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

  // A user message is one row from sending through queued to saved, keyed by
  // its cid, so its bubble isn't rebuilt as it moves.
  type UserRow = {
    kind: "user";
    key: string;
    entry?: UserMessage;
    text: string;
    images?: readonly ImageContent[];
    queued?: boolean;
    outbox?: OutboxItem;
  };
  type DisplayRow = { kind: "entry"; key: string; entry: LogEntry } | { kind: "thinking"; key: string } | UserRow;

  const compactingRow: CompactionEntry = { kind: "compaction", id: "live:compaction", at: 0, status: "running" };

  interface ScrollAnchor {
    entryId: string;
    top: number;
  }

  // Key agent rows by the slot after the previous entry so the thinking row
  // can turn into the first real agent row without a remove/add layout jolt.
  const agentSlotKey = (previous: LogEntry | undefined): string => `agent-slot:${previous?.id ?? "start"}`;

  const totalEntries = $derived(chatLogState.entries.length);
  const hasLocalEarlierEntries = $derived(visibleCount < totalEntries);
  const hasEarlierEntries = $derived(hasLocalEarlierEntries || chatLogState.more !== undefined);
  const visibleStartIndex = $derived(Math.max(0, totalEntries - visibleCount));
  // What pi hasn't saved yet follows the saved rows: the reply being streamed,
  // the tool calls the model is writing, and a compaction in progress.
  const liveEntries = $derived.by(() => [
    ...(chatLogState.streaming ? [chatLogState.streaming] : []),
    ...chatLogState.streamingCalls,
    ...(chatLogState.live.compacting ? [compactingRow] : []),
  ]);
  const visibleEntries = $derived.by(() => [...chatLogState.entries.slice(visibleStartIndex), ...liveEntries]);
  const latestEntry = $derived.by(() => liveEntries.at(-1) ?? chatLogState.entries.at(-1));

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

  function previousRenderableEntryBefore(index: number): LogEntry | undefined {
    for (let i = index - 1; i >= 0; i -= 1) {
      const entry = chatLogState.entries[i];
      if (isRenderableEntry(entry)) return entry;
    }
    return undefined;
  }

  // Where each turn's copy / branch / details sit: under its final answer, the
  // message pi ended the turn with (any stop reason but toolUse). When that
  // message has no text, under the turn's last text before it.
  const turnEnds = $derived.by(() => {
    const ends = new Set<string>();
    let lastText: string | undefined;
    for (const entry of visibleEntries) {
      if (entry.kind === "user") lastText = undefined;
      if (entry.kind !== "assistant" || entry.streaming) continue;
      if (entry.text.length > 0) lastText = entry.id;
      if (entry.stopReason === undefined || entry.stopReason === "toolUse") continue;
      if (lastText) ends.add(lastText);
      lastText = undefined;
    }
    return ends;
  });

  const latestEntryIsCurrentAgentOutput = $derived.by(() => isCurrentAgentOutput(latestEntry));
  const showThinkingIndicator = $derived(activeSessionState.status === "thinking" && !latestEntryIsCurrentAgentOutput);
  // Rows are reused while their entry and key are unchanged: a new row object
  // makes the keyed {#each} re-run every row's effects (re-highlighting every
  // visible diff) on each streamed delta. Entries mutate in place, so text
  // still updates through them.
  let rowCache = new Map<string, DisplayRow>();
  const displayRows = $derived.by(() => {
    const rows: DisplayRow[] = [];
    const nextCache = new Map<string, DisplayRow>();
    let previousRenderedEntry = previousRenderableEntryBefore(visibleStartIndex);

    for (const entry of visibleEntries) {
      if (!isRenderableEntry(entry)) continue;
      // A tool row keeps its key from being written through being saved.
      const key =
        entry.kind === "user" ? (entry.cid ?? entry.id) : entry.kind === "tool_call" ? `tool:${entry.id}` : agentSlotKey(previousRenderedEntry);
      const cached = rowCache.get(key);
      const row: DisplayRow =
        cached && "entry" in cached && cached.entry === entry
          ? cached
          : entry.kind === "user"
            ? { kind: "user", key, entry, text: entry.text, images: entry.images }
            : { kind: "entry", entry, key };
      nextCache.set(key, row);
      rows.push(row);
      previousRenderedEntry = entry;
    }
    rowCache = nextCache;

    for (const item of chatLogState.outbox) rows.push({ kind: "user", key: item.cid, text: item.text, images: item.images, outbox: item });
    if (showThinkingIndicator) rows.push({ kind: "thinking", key: agentSlotKey(previousRenderedEntry) });
    chatLogState.live.queue.forEach((item, index) =>
      rows.push({ kind: "user", key: item.cid ?? `queued:${index}:${item.text}`, text: item.text, images: chatLogState.images(item.cid), queued: true }),
    );
    // A duplicate key would throw in the keyed {#each}; keep the first.
    const keys = new Set<string>();
    return rows.filter((row) => !keys.has(row.key) && keys.add(row.key));
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

  // Pins to the latest row now and for the next few frames while layout
  // settles (keyboard, composer), unless the reader scrolls away meanwhile.
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

  // Rows that arrive after the chat has synced fade in; the snapshot it opens
  // with, and earlier history loaded above, don't.
  let rowsArrive = false;
  const arrive = (node: HTMLElement) => {
    if (rowsArrive && !loadingEarlier) node.classList.add("msg-enter");
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
      // Shown at the top with a retry; the observer waits for it.
      earlierFailed = true;
      return;
    } finally {
      loadingEarlier = false;
    }
    // Still within reach of the top: keep going.
    if (scroller && !stuckToBottom && hasEarlierEntries && scroller.scrollTop < earlierLead()) void revealEarlierEntries();
  }

  const earlierLead = () => (scroller?.clientHeight ?? 0) * LOAD_EARLIER_SCREENS;

  function onScroll(): void {
    const stuck = distanceFromBottom() < STICK_THRESHOLD_PX;
    stuckToBottom = stuck;
    if (stuck) hasNewActivity = false;
    noteReadingPlace();
  }

  // Where the reader is, noted once scrolling settles: by the time the chat
  // closes, its rows may already be off the page and can't be measured.
  let readingAnchor: ScrollAnchor | null = null;
  let readingTimer: ReturnType<typeof setTimeout> | undefined;

  function noteReadingPlace(): void {
    clearTimeout(readingTimer);
    readingTimer = setTimeout(() => (readingAnchor = captureScrollAnchor()), 150);
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
    // Back to where the reader left this chat, unless they were following the
    // end (or it was never opened, or a branch switch reset it).
    const reading = chatLogState.reading(sessionId);
    const returning = reading && !reading.following && reading.anchor;
    if (returning) {
      visibleCount = Math.max(visibleCount, reading.visibleCount);
      // Not following the end, so nothing pins it there meanwhile.
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
    const resizeObserver = new ResizeObserver(() => {
      if (!scroller) return;

      const nextHeight = scroller.clientHeight;
      const lostHeight = Math.max(0, lastScrollerHeight - nextHeight);
      lastScrollerHeight = nextHeight;

      // When the keyboard/composer changes height, keep the latest message pinned
      // only if the user was already following the bottom of the chat.
      if (stuckToBottom || distanceFromBottom() <= STICK_THRESHOLD_PX + lostHeight) {
        void scrollToLatest();
      }
    });
    if (scroller) resizeObserver.observe(scroller);

    // Rows also grow after they render (an image loads, code is highlighted,
    // a pane opens): keep following the bottom through that.
    const growthObserver = new ResizeObserver(() => {
      if (stuckToBottom) scheduleScrollSync();
    });
    if (rowList) growthObserver.observe(rowList);

    return () => {
      clearTimeout(readingTimer);
      chatLogState.saveReading(sessionId, { anchor: readingAnchor, visibleCount, following: stuckToBottom });
      resizeObserver.disconnect();
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
        if (stuckToBottom || earlierFailed) return;
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
        <!-- A turn starts with your message; its steps sit closer together. -->
        <div class={["column", index > 0 && (row.kind === "user" ? "pt-turn" : "pt-step")]} data-log-entry-id={row.kind === "thinking" ? undefined : row.entry?.id} {@attach arrive}>
          {#if row.kind === "thinking"}
            <AgentThinkingIndicator />
          {:else if row.kind === "user"}
            <UserMessageView text={row.text} images={row.images} queued={row.queued} outbox={row.outbox} {sessionId} />
          {:else if row.entry.kind === "assistant"}
            <AssistantMessageView msg={row.entry} {sessionId} endsTurn={turnEnds.has(row.entry.id)} />
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
