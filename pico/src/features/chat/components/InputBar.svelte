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
  import { createLatest } from "@/shared/lib/latest";
  import { clearChatDraft, loadChatDraft, saveChatDraft } from "@/features/chat/model/chat-draft";
  import ComposerActionButton from "./ComposerActionButton.svelte";
  import ComposerModelControls from "./ComposerModelControls.svelte";
  import ImageTray from "@/features/chat/components/ImageTray.svelte";
  import CompactContextSheet from "@/features/chat/components/CompactContextSheet.svelte";
  import QueuedMessagesSheet from "@/features/chat/components/QueuedMessagesSheet.svelte";
  import SlashCommandSuggestions from "@/features/chat/components/SlashCommandSuggestions.svelte";
  import { createSlashCommandsState, type CommandEntry, type SlashCommandCompletion } from "@/features/chat/components/slash-commands.state.svelte";

  const LONG_PRESS_MS = 500;
  const MAX_IMAGES = 4;
  const DRAFT_SAVE_DELAY_MS = 350;

  let {
    sessionId,
    contextStats,
    compactOpen = $bindable(false),
  }: {
    sessionId: string;
    contextStats?: { cost: number; usage: NonNullable<SessionStats["contextUsage"]> };
    compactOpen?: boolean;
  } = $props();

  let textarea = $state<HTMLTextAreaElement | null>(null);
  let value = $state("");
  let cursor = $state(0);
  let composing = $state(false);
  let holding = $state(false);
  let ignoreNextSendClick = false;
  let sendPointerId: number | null = null;
  let queueOpen = $state(false);
  let images = $state<ImageContent[]>([]);
  let draftSessionId = untrack(() => sessionId);
  let draftSaved = $state(true);
  let preparingImages = $state(false);
  let destroyed = false;
  const imagePreparation = createLatest();

  const slashCommands = createSlashCommandsState(
    () => sessionId,
    () => value,
    () => cursor,
  );

  onDestroy(() => {
    destroyed = true;
    imagePreparation.begin();
    cancelSendPress();
    persistDraft();
  });

  const busy = $derived(activeSessionState.status === "thinking" || activeSessionState.status === "tool");
  const hasText = $derived(value.trim().length > 0);
  const hasSendable = $derived(hasText || images.length > 0);
  const canSend = $derived(activeSessionState.connectionStatus !== "gone" && !preparingImages);
  const queue = $derived(chatLogState.live.queue);
  const queueCount = $derived(queue.length);
  const bottomPadding = $derived(keyboardState.height > 0 ? "0px" : "env(safe-area-inset-bottom)");

  function clearImages(): void {
    images.length = 0;
  }

  $effect(() => {
    const id = sessionId;
    untrack(() => {
      if (draftSessionId !== id) {
        persistDraft();
        imagePreparation.begin();
        preparingImages = false;
      }
      draftSessionId = id;
      restoreDraft(id);
    });
  });

  $effect(() => {
    const save = () => persistDraft();
    const saveWhenHidden = () => { if (document.hidden) save(); };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  });

  $effect(() => {
    const request = queuedMessageActionsState.takeRecall(sessionId);
    if (!request) return;
    value = [request.text, untrack(() => value)].filter((text) => text.trim()).join("\n\n");
    if (request.images) untrack(() => addImages(request.images ?? []));
    cursor = value.length;
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(value.length, value.length);
    });
  });

  $effect(() => {
    const id = sessionId;
    const draft = { text: value, images: cloneImageContent(images) ?? [] };
    const timer = window.setTimeout(() => {
      const saved = saveChatDraft(id, draft);
      if (id === draftSessionId) draftSaved = saved;
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

  function persistDraft(): void {
    draftSaved = saveChatDraft(draftSessionId, { text: value, images });
  }

  function restoreDraft(id: string): void {
    const draft = loadChatDraft(id);
    value = draft.text;
    images = cloneImageContent(draft.images) ?? [];
    draftSaved = draft.saved;
    cursor = 0;
  }

  function submit(mode: "steer" | "follow_up"): void {
    const text = value.trim();
    const sentImages = cloneImageContent(images);
    if ((!text && !sentImages) || !canSend) return;
    draftSaved = clearChatDraft(sessionId);
    try {
      chatLogState.send(sessionId, { text, mode, images: sentImages });
    } catch (error) {
      draftSaved = saveChatDraft(sessionId, { text: value, images });
      actionError = `couldn't prepare message · ${shortFailureText(error)}`;
      return;
    }
    value = "";
    cursor = 0;
    clearImages();
  }

  let stopping = $state(false);
  let actionError = $state<string | null>(null);

  $effect(() => {
    if (!busy) stopping = false;
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

  function cancelSendPress(): void {
    clearSendPointerListeners();
    sendPointerId = null;
    ignoreNextSendClick = true;
    sendPress.end();
  }

  const SEND_SLOP_PX = 12;
  let sendBounds: DOMRect | null = null;

  const keepTextareaFocused = (event: PointerEvent) => event.preventDefault();

  function handleSendPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !hasSendable || !canSend) return;

    keepTextareaFocused(event);
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

  function receiveImages(id: string, next: readonly ImageContent[]): void {
    if (!destroyed && draftSessionId === id) {
      addImages(next);
      persistDraft();
      return;
    }
    const draft = loadChatDraft(id);
    saveChatDraft(id, { text: draft.text, images: [...draft.images, ...next].slice(0, MAX_IMAGES) });
  }

  async function attachImages(): Promise<void> {
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0 || preparingImages) return;
    const id = sessionId;
    const owner = imagePreparation.begin();
    preparingImages = true;
    actionError = null;
    try {
      receiveImages(id, await pickImages(remaining));
    } catch (error) {
      if (imagePreparation.isCurrent(owner)) actionError = `couldn't attach image · ${shortFailureText(error)}`;
    } finally {
      if (imagePreparation.isCurrent(owner)) preparingImages = false;
    }
  }

  async function handlePaste(event: ClipboardEvent): Promise<void> {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
    const remaining = MAX_IMAGES - images.length;
    if (files.length === 0 || remaining <= 0 || preparingImages) return;
    event.preventDefault();
    const id = sessionId;
    const owner = imagePreparation.begin();
    preparingImages = true;
    actionError = null;
    try {
      receiveImages(id, await filesToImageContent(files, remaining));
    } catch (error) {
      if (imagePreparation.isCurrent(owner)) actionError = `couldn't attach image · ${shortFailureText(error)}`;
    } finally {
      if (imagePreparation.isCurrent(owner)) preparingImages = false;
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
  {#if !draftSaved}
    <p class="column type-meta px-3 pt-1 text-[color:var(--color-warn)]" role="alert">draft couldn't be saved on this device · keep this page open</p>
  {/if}
  {#if preparingImages}
    <p class="column type-meta px-3 pt-1 text-[color:var(--color-fg-muted)]" role="status">preparing image…</p>
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

  <div class="m-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] focus-within:border-[color:var(--color-border-strong)]">
    <textarea
      bind:this={textarea}
      data-keyboard-editor
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

    <div class="flex items-center gap-1 px-1.5 pb-1.5 {busy && queueCount > 0 ? 'max-[360px]:gap-0' : ''}">
      <ComposerActionButton type="button" variant="ghost" onpointerdown={keepTextareaFocused} onclick={attachImages} disabled={images.length >= MAX_IMAGES || preparingImages} class="text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface-2)]" aria-label="Attach image" title="Attach image">
        <ImagePlus size={20} class="size-5" />
      </ComposerActionButton>

      <ComposerModelControls {sessionId} onpointerdown={keepTextareaFocused} />

      {#if queueCount > 0}
        <ComposerActionButton type="button" variant="ghost" onclick={() => (queueOpen = true)} class="text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface-2)]" aria-label="Queued messages" title="Queued messages">
          <ListTodo size={20} class="size-5" />
          <span class="absolute right-0.5 top-0.5 flex min-w-4 translate-x-1/3 -translate-y-1/3 items-center justify-center rounded-full border border-[color:var(--color-surface)] bg-[color:var(--color-accent)] px-1 py-0.5 text-[0.625rem] font-medium leading-none text-[color:var(--color-on-accent)]">
            {queueCount > 99 ? "99+" : queueCount}
          </span>
        </ComposerActionButton>
      {/if}

      {#if busy}
        <ComposerActionButton type="button" variant="outline" onclick={interrupt} disabled={stopping} aria-label={stopping ? "Stopping" : "Stop"} title={stopping ? "Stopping…" : "Stop the current turn"} class="active:opacity-80">
          <Square class="size-3" fill="currentColor" />
        </ComposerActionButton>
      {/if}
      <ComposerActionButton
        type="button"
        onclick={handleSendClick}
        onpointerdown={handleSendPointerDown}
        disabled={!hasSendable || !canSend}
        class={`bg-[color:var(--color-accent)] text-[color:var(--color-on-accent)] transition-transform duration-100 active:opacity-80 disabled:bg-[color:var(--color-surface-2)] disabled:text-[color:var(--color-fg-faint)] disabled:opacity-100 ${holding ? "scale-95" : ""}`}
        aria-label={busy ? "Steer (hold to queue a follow-up)" : "Send"}
        title={hasSendable ? (chatLogState.live.compacting ? "Queue until compaction finishes" : busy ? "Tap to steer · hold to queue a follow-up" : "Send · hold to queue a follow-up") : "Draft a message to send"}
      >
        <ArrowUp class="size-3.5" strokeWidth={2.5} />
      </ComposerActionButton>
    </div>
  </div>

  <CompactContextSheet bind:open={compactOpen} {sessionId} usage={contextStats?.usage} {busy} compacting={chatLogState.live.compacting} onError={(message) => (actionError = message)} />

  <QueuedMessagesSheet
    bind:open={queueOpen}
    {queue}
    error={queuedMessageActionsState.restoreError}
    clearing={queuedMessageActionsState.restoring}
    onClear={restoreQueue}
  />

</div>
