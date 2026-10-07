<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { ArrowUp, ImagePlus, ListTodo, Square } from "@lucide/svelte";
  import type { ImageContent, SessionStats } from "@pico/protocol";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
  import { queuedMessageActionsState } from "@/features/chat/model/queued-message-actions.state.svelte";
  import { keyboardState } from "@/shared/mobile/keyboard.svelte";
  import { pickImages } from "@/shared/mobile/image-picker";
  import { cloneImageContent, filesToImageContent } from "@/shared/mobile/image-content";
  import { createLongPress } from "@/shared/gestures/long-press";
  import { interruptSession } from "@/features/chat/api";
  import { runRpc } from "@/shared/lib/rpc-client";
  import { shortFailureText } from "@/shared/lib/host-issues";
  import { formatCost } from "@/shared/lib/format";
  import { clearChatDraft, loadChatDraft, saveChatDraft } from "@/features/chat/model/chat-draft";
  import { Button } from "@/shared/ui/button";
  import * as Sheet from "@/shared/ui/sheet";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import ImageTray from "@/features/chat/components/ImageTray.svelte";
  import CompactContextSheet from "@/features/chat/components/CompactContextSheet.svelte";
  import QueuedMessagesSheet from "@/features/chat/components/QueuedMessagesSheet.svelte";
  import SessionSettingsView from "@/features/chat/actions/SessionSettingsView.svelte";
  import SlashCommandSuggestions from "@/features/chat/components/SlashCommandSuggestions.svelte";
  import { createSlashCommandsState, type CommandEntry, type SlashCommandCompletion } from "@/features/chat/components/slash-commands.state.svelte";

  const LONG_PRESS_MS = 500;
  const MAX_IMAGES = 4;
  const DRAFT_SAVE_DELAY_MS = 350;

  let {
    sessionId,
    contextStats,
  }: {
    sessionId: string;
    contextStats?: { cost: number; usage: NonNullable<SessionStats["contextUsage"]> };
  } = $props();

  const controls = $derived(activeSessionState.controls.value);
  let modelOpen = $state(false);

  let textarea = $state<HTMLTextAreaElement | null>(null);
  let value = $state("");
  let cursor = $state(0);
  let composing = $state(false);
  let holding = $state(false);
  let ignoreNextSendClick = false;
  let sendPointerId: number | null = null;
  let compactOpen = $state(false);
  let queueOpen = $state(false);
  let images = $state<ImageContent[]>([]);
  let lastRecallRequestId = 0;

  const slashCommands = createSlashCommandsState(
    () => sessionId,
    () => value,
    () => cursor,
  );

  onDestroy(() => {
    // A press in progress dies with the composer instead of sending later.
    cancelSendPress();
    // Keep what was typed in the last moments before leaving.
    saveChatDraft(sessionId, value);
  });

  const busy = $derived(activeSessionState.status === "thinking" || activeSessionState.status === "tool");
  const hasText = $derived(value.trim().length > 0);
  const hasSendable = $derived(hasText || images.length > 0);
  // Sends go over HTTP and wait in the outbox, so only a deleted session can't take one.
  const canSend = $derived(activeSessionState.connectionStatus !== "gone");
  const queue = $derived(chatLogState.live.queue);
  const queueCount = $derived(queue.length);
  const contextPercent = $derived(
    contextStats && contextStats.usage.percent !== null ? Math.round(contextStats.usage.percent) : null,
  );
  const bottomPadding = $derived(keyboardState.height > 0 ? "0px" : "env(safe-area-inset-bottom)");

  const modelControl = $derived(controls?.controls.find((control) => control.key === "model"));
  const modelLabel = $derived.by(() => {
    const mc = modelControl;
    if (!mc || mc.kind !== "select") return null;
    return mc.options.find((option) => option.value === mc.value)?.label ?? mc.value;
  });

  function clearImages(): void {
    images.length = 0;
  }


  // The model chip, loaded with the chat. The model sheet shares this copy and
  // updates it from its change, so closing the sheet needs no reload; a failed
  // load keeps the chip as it was.
  $effect(() => {
    sessionId;
    untrack(() => void activeSessionState.controls.load(sessionId).catch(() => {}));
  });

  $effect(() => {
    sessionId;
    untrack(() => restoreDraft());
  });

  $effect(() => {
    const request = queuedMessageActionsState.recallRequest;
    if (!request || request.sessionId !== sessionId || request.id === lastRecallRequestId) return;

    lastRecallRequestId = request.id;
    // Ahead of any draft, as pi's dequeue does.
    value = [request.text, untrack(() => value)].filter((text) => text.trim()).join("\n\n");
    if (request.images) untrack(() => addImages(request.images ?? []));
    cursor = value.length;
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(value.length, value.length);
    });
  });

  $effect(() => {
    const draftSessionId = sessionId;
    const draftText = value;
    const timer = window.setTimeout(() => {
      saveChatDraft(draftSessionId, draftText);
    }, DRAFT_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  });

  function autosize(node: HTMLTextAreaElement, _value: string) {
    const resize = () => {
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
    };

    resize();
    return { update: resize };
  }

  function updateCursor(node: HTMLTextAreaElement): void {
    cursor = node.selectionStart ?? value.length;
  }

  function restoreDraft(): void {
    value = loadChatDraft(sessionId);
    cursor = 0;
    clearImages();
  }

  function submit(mode: "steer" | "follow_up"): void {
    const text = value.trim();
    const sentImages = cloneImageContent(images);
    if ((!text && !sentImages) || !canSend) return;
    chatLogState.send(sessionId, { text, mode, images: sentImages });
    value = "";
    cursor = 0;
    clearImages();
    clearChatDraft(sessionId);
  }

  // Stopping until the run ends; a failed request says so above the composer.
  let stopping = $state(false);
  // A composer action that failed (stop, compaction), until the next one or a tap.
  let actionError = $state<string | null>(null);
  let modelError = $state<string | null>(null);

  $effect(() => {
    if (!busy) stopping = false;
  });

  $effect(() => {
    if (modelOpen) untrack(() => (modelError = null));
  });

  async function interrupt(): Promise<void> {
    if (stopping) return;
    stopping = true;
    actionError = null;
    try {
      await runRpc(interruptSession(sessionId));
    } catch (error) {
      stopping = false;
      actionError = `couldn't stop · ${shortFailureText(error)}`;
    }
  }

  // Tap sends/steers; long-press queues a follow-up — pi's alt+enter, as a touch gesture.
  const sendPress = createLongPress({
    delayMs: LONG_PRESS_MS,
    enabled: () => hasSendable && canSend,
    onStart: () => (holding = true),
    onCancel: () => (holding = false),
    onLongPress: () => {
      holding = false;
      submit("follow_up");
    },
  });

  function clearSendPointerListeners(): void {
    window.removeEventListener("pointermove", handleWindowSendPointerMove, { capture: true });
    window.removeEventListener("pointerup", handleWindowSendPointerUp, { capture: true });
    window.removeEventListener("pointercancel", handleWindowSendPointerCancel, { capture: true });
    window.removeEventListener("blur", cancelSendPress);
  }

  // Ends a press without sending, including the click that may follow it.
  function cancelSendPress(): void {
    clearSendPointerListeners();
    sendPointerId = null;
    ignoreNextSendClick = true;
    sendPress.end();
  }

  // Like a native button, a press that wanders off Send doesn't send.
  const SEND_SLOP_PX = 12;
  let sendBounds: DOMRect | null = null;

  function handleSendPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !hasSendable || !canSend) return;

    // Keep the textarea focused so the on-screen keyboard and layout don't
    // move under the finger before the tap completes.
    event.preventDefault();
    clearSendPointerListeners();
    ignoreNextSendClick = false;
    sendPointerId = event.pointerId;
    sendBounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    sendPress.start(event);
    window.addEventListener("pointermove", handleWindowSendPointerMove, { capture: true });
    window.addEventListener("pointerup", handleWindowSendPointerUp, { capture: true });
    window.addEventListener("pointercancel", handleWindowSendPointerCancel, { capture: true });
    window.addEventListener("blur", cancelSendPress);
  }

  function finishSendPointer(): void {
    clearSendPointerListeners();
    sendPointerId = null;
    ignoreNextSendClick = true;
    sendPress.end();
    if (sendPress.consumeClick()) return;
    submit("steer");
  }

  function handleWindowSendPointerMove(event: PointerEvent): void {
    if (event.pointerId !== sendPointerId || !sendBounds) return;
    const { left, right, top, bottom } = sendBounds;
    const { clientX: x, clientY: y } = event;
    if (x < left - SEND_SLOP_PX || x > right + SEND_SLOP_PX || y < top - SEND_SLOP_PX || y > bottom + SEND_SLOP_PX) {
      cancelSendPress();
    }
  }

  function handleWindowSendPointerUp(event: PointerEvent): void {
    if (sendPointerId !== null && event.pointerId !== sendPointerId) return;
    event.preventDefault();
    finishSendPointer();
  }

  function handleWindowSendPointerCancel(event: PointerEvent): void {
    if (sendPointerId !== null && event.pointerId !== sendPointerId) return;
    cancelSendPress();
  }

  function handleSendClick(): void {
    if (ignoreNextSendClick) {
      ignoreNextSendClick = false;
      return;
    }
    if (sendPress.consumeClick()) return;
    submit("steer");
  }

  function applyCommandCompletion(completion: SlashCommandCompletion): void {
    value = completion.value;
    cursor = completion.cursor;
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(completion.cursor, completion.cursor);
    });
  }

  function completeCommand(entry: CommandEntry): void {
    applyCommandCompletion(slashCommands.complete(entry));
  }

  function handleCommandKey(event: KeyboardEvent): boolean {
    const completion = slashCommands.handleKey(event);
    if (!completion) return event.defaultPrevented;
    applyCommandCompletion(completion);
    return true;
  }

  function addImages(next: readonly ImageContent[]): void {
    const cloned = cloneImageContent(next);
    if (!cloned) return;
    images.push(...cloned);
    if (images.length > MAX_IMAGES) images.splice(MAX_IMAGES);
  }

  async function attachImages(): Promise<void> {
    try {
      const remaining = MAX_IMAGES - images.length;
      if (remaining <= 0) return;
      addImages(await pickImages(remaining));
    } catch (error) {
      console.warn("[input-bar] image pick failed:", error);
    }
  }

  async function handlePaste(event: ClipboardEvent): Promise<void> {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
    const remaining = MAX_IMAGES - images.length;
    if (files.length === 0 || remaining <= 0) return;
    event.preventDefault();

    try {
      addImages(await filesToImageContent(files, remaining));
    } catch (error) {
      console.warn("[input-bar] image paste failed:", error);
    }
  }

  function removeImage(index: number): void {
    if (index < 0 || index >= images.length) return;
    images.splice(index, 1);
  }

  async function restoreQueue(): Promise<void> {
    if (await queuedMessageActionsState.restoreQueue(sessionId)) queueOpen = false;
  }
</script>

<div class="pointer-events-auto relative z-20 shrink-0" style:padding-bottom={bottomPadding}>
  {#if actionError}
    <div class="column type-meta flex items-baseline gap-2 px-3 pt-1 text-[color:var(--color-danger)]" role="alert">
      <span class="min-w-0 flex-1">{actionError}</span>
      <button type="button" class="shrink-0 text-[color:var(--color-fg-muted)] active:opacity-70" onclick={() => (actionError = null)}>dismiss</button>
    </div>
  {/if}
  {#if slashCommands.query !== null}
    <SlashCommandSuggestions
      entries={slashCommands.matches}
      selectedIndex={slashCommands.selectedIndex}
      loading={slashCommands.loading}
      error={slashCommands.error}
      onPick={completeCommand}
      onSelect={slashCommands.select}
    />
  {/if}

  <ImageTray {images} onRemove={removeImage} />

  <!--
    One composer card (Claude-style): the textarea on top, a control row beneath
    it inside the same card. Visible controls live in the row rather than hidden
    in a menu — context budget as a chip, the rest as icon buttons.
  -->
  <div class="m-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] focus-within:border-[color:var(--color-border-strong)]">
    <textarea
      bind:this={textarea}
      bind:value
      use:autosize={value}
      oninput={(event) => {
        updateCursor(event.currentTarget);
      }}
      onpaste={(event) => void handlePaste(event)}
      onclick={(event) => updateCursor(event.currentTarget)}
      onkeyup={(event) => updateCursor(event.currentTarget)}
      onselect={(event) => updateCursor(event.currentTarget)}
      oncompositionstart={() => (composing = true)}
      oncompositionend={(event) => {
        composing = false;
        updateCursor(event.currentTarget);
      }}
      onkeydown={(event) => {
        if (handleCommandKey(event)) return;
        if (event.key === "Enter" && !event.shiftKey && !composing) {
          event.preventDefault();
          submit("steer");
        }
      }}
      rows="1"
      placeholder="ask, or / for commands"
      class="type-input font-prose w-full resize-none bg-transparent px-3 pt-2 pb-1 text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-faint)] focus:outline-none"
    ></textarea>

    <div class="flex items-center gap-1 px-1.5 pb-1.5">
      <Button type="button" variant="ghost" size="icon" onpointerdown={(event) => event.preventDefault()} onclick={attachImages} disabled={images.length >= MAX_IMAGES} class="shrink-0 rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface-2)]" aria-label="Attach image" title="Attach image">
        <ImagePlus class="size-4" />
      </Button>

      {#if modelLabel}
        <button
          type="button"
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => (modelOpen = true)}
          class="type-meta max-w-[12ch] shrink-0 truncate rounded-[var(--radius-sm)] px-2 py-1.5 text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface-2)]"
          aria-label="Model — tap to change"
          title="Change model"
        >
          {modelLabel}
        </button>
      {/if}

      {#if contextStats}
        <button
          type="button"
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => (compactOpen = true)}
          class="type-meta shrink-0 rounded-[var(--radius-sm)] px-2 py-1.5 tabular-nums text-[color:var(--color-fg-faint)] active:bg-[color:var(--color-surface-2)]"
          aria-label="Context usage — tap to compact"
          title="Compact context"
        >
          {contextPercent !== null ? `${contextPercent}%` : "—"} · {formatCost(contextStats.cost)}
        </button>
      {/if}

      <div class="min-w-0 flex-1"></div>

      {#if queueCount > 0}
        <Button type="button" variant="ghost" size="icon" onclick={() => (queueOpen = true)} class="relative shrink-0 rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface-2)]" aria-label="Queued messages" title="Queued messages">
          <ListTodo class="size-4" />
          <span class="absolute right-0.5 top-0.5 flex min-w-4 translate-x-1/3 -translate-y-1/3 items-center justify-center rounded-full border border-[color:var(--color-surface)] bg-[color:var(--color-accent)] px-1 py-0.5 text-[0.625rem] font-medium leading-none text-[color:var(--color-on-accent)]">
            {queueCount > 99 ? "99+" : queueCount}
          </span>
        </Button>
      {/if}

      {#if busy}
        <Button type="button" variant="outline" size="icon" onclick={interrupt} disabled={stopping} aria-label={stopping ? "Stopping" : "Stop"} title={stopping ? "Stopping…" : "Stop the current turn"} class="shrink-0 rounded-[var(--radius-sm)] active:opacity-80">
          <Square class="size-3" fill="currentColor" />
        </Button>
      {/if}
      <!-- Keep mounted after submit clears the draft so the follow-up click can't retarget to Stop. -->
      <Button
        type="button"
        size="icon-lg"
        onclick={handleSendClick}
        onpointerdown={handleSendPointerDown}
        disabled={!hasSendable || !canSend}
        class={`shrink-0 rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] text-[color:var(--color-on-accent)] transition-transform duration-100 active:opacity-80 disabled:bg-[color:var(--color-surface-2)] disabled:text-[color:var(--color-fg-faint)] disabled:opacity-100 ${holding ? "scale-95" : ""}`}
        aria-label={busy ? "Steer (hold to queue a follow-up)" : "Send"}
        title={hasSendable ? (chatLogState.live.compacting ? "Queue until compaction finishes" : busy ? "Tap to steer · hold to queue a follow-up" : "Send · hold to queue a follow-up") : "Draft a message to send"}
      >
        <ArrowUp class="size-3.5" strokeWidth={2.5} />
      </Button>
    </div>
  </div>

  <CompactContextSheet bind:open={compactOpen} {sessionId} onError={(message) => (actionError = message)} />

  <QueuedMessagesSheet
    bind:open={queueOpen}
    {queue}
    error={queuedMessageActionsState.restoreError}
    clearing={queuedMessageActionsState.restoring}
    onClear={restoreQueue}
  />

  <Sheet.Root bind:open={modelOpen}>
    <Sheet.BottomContent class="max-h-[82dvh]">
      <SheetHeader title="model" />
      {#if modelError}
        <p class="type-meta px-3 pt-2 text-[color:var(--color-danger)]" role="alert">{modelError}</p>
      {/if}
      <SessionSettingsView {sessionId} onError={(message) => (modelError = message)} filterKeys={["model"]} />
    </Sheet.BottomContent>
  </Sheet.Root>
</div>
