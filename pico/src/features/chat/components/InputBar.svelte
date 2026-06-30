<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { ArrowUp, ImagePlus, ListTodo, Mic, MicOff, Plus, Square } from "@lucide/svelte";
  import type { ImageContent, SessionControls, SessionStats } from "@pico/protocol";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
  import { chatQueueState } from "@/features/chat/model/chat-queue.state.svelte";
  import { queuedMessageActionsState } from "@/features/chat/model/queued-message-actions.state.svelte";
  import { createSpeechRecognitionState } from "@/shared/mobile/speech.svelte";
  import { keyboardState } from "@/shared/mobile/keyboard.svelte";
  import { pickImages } from "@/shared/mobile/image-picker";
  import { cloneImageContent, filesToImageContent } from "@/shared/mobile/image-content";
  import { haptics } from "@/shared/mobile/haptics";
  import { createLongPress } from "@/shared/gestures/long-press";
  import { clearSessionQueue, getSessionQueue, getSessionSettings } from "@/features/chat/api";
  import { hostIssueSummary } from "@/shared/lib/host-issues";
  import { runOnHost } from "@/shared/lib/rpc-client";
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
    hostId,
    sessionId,
    contextStats,
  }: {
    hostId: string;
    sessionId: string;
    contextStats?: { cost: number; usage: NonNullable<SessionStats["contextUsage"]> };
  } = $props();

  let controls = $state<SessionControls | null>(null);
  let modelOpen = $state(false);

  let textarea = $state<HTMLTextAreaElement | null>(null);
  let value = $state("");
  let cursor = $state(0);
  let composing = $state(false);
  let holding = $state(false);
  let ignoreNextSendClick = false;
  let sendPointerId: number | null = null;
  let actionsOpen = $state(false);
  let compactOpen = $state(false);
  let queueOpen = $state(false);
  let images = $state<ImageContent[]>([]);
  let queueLoading = $state(false);
  let queueError = $state<string | null>(null);
  let clearing = $state(false);
  let queueRequestId = 0;
  let draftLoadRequestId = 0;
  let draftLoadedFor = $state<string | null>(null);
  let draftEditVersion = 0;
  let lastRecallRequestId = 0;

  const stt = createSpeechRecognitionState();
  const slashCommands = createSlashCommandsState(
    () => hostId,
    () => sessionId,
    () => value,
    () => cursor,
  );
  let textBeforeRecording = "";

  onMount(() => {
    void stt.checkAvailability();
  });

  onDestroy(() => {
    clearSendPointerListeners();
    stt.destroy();
  });

  const busy = $derived(activeSessionState.status === "thinking" || activeSessionState.status === "tool");
  const hasText = $derived(value.trim().length > 0);
  const hasSendable = $derived(hasText || images.length > 0);
  const canSend = $derived(activeSessionState.send !== null);
  const queue = $derived(chatQueueState.get(hostId, sessionId));
  const queueCount = $derived(chatQueueState.count(hostId, sessionId));
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

  async function loadControls(): Promise<void> {
    try {
      controls = await runOnHost(hostId, getSessionSettings(sessionId));
    } catch {
      controls = null;
    }
  }

  // Refresh the model chip on session change and after the picker sheet closes.
  $effect(() => {
    hostId;
    sessionId;
    if (modelOpen) return;
    untrack(() => void loadControls());
  });

  $effect(() => {
    if (!stt.listening) return;
    const transcript = stt.transcript;
    draftEditVersion += 1;
    value = textBeforeRecording ? `${textBeforeRecording.trimEnd()} ${transcript}` : transcript;
  });

  $effect(() => {
    const key = `${hostId}:${sessionId}`;
    untrack(() => {
      void restoreDraft(hostId, sessionId, key);
      void syncQueue();
    });
  });

  $effect(() => {
    const request = queuedMessageActionsState.recallRequest;
    if (!request || request.hostId !== hostId || request.sessionId !== sessionId || request.id === lastRecallRequestId) return;

    lastRecallRequestId = request.id;
    draftEditVersion += 1;
    value = request.text;
    cursor = request.text.length;
    images = cloneImageContent(request.images) ?? [];
    textBeforeRecording = "";
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(request.text.length, request.text.length);
    });
  });

  $effect(() => {
    const key = `${hostId}:${sessionId}`;
    const draftText = value;
    if (draftLoadedFor !== key) return;

    const timer = window.setTimeout(() => {
      void saveChatDraft(hostId, sessionId, draftText);
    }, DRAFT_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  });

  $effect(() => {
    if (!actionsOpen) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-input-actions]")) return;
      actionsOpen = false;
    };

    window.addEventListener("pointerdown", closeOnOutsidePointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown, { capture: true });
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

  async function restoreDraft(nextHostId: string, nextSessionId: string, key: string): Promise<void> {
    const requestId = ++draftLoadRequestId;
    const editVersion = draftEditVersion;
    draftLoadedFor = null;
    value = "";
    cursor = 0;
    images = [];
    textBeforeRecording = "";

    const draftText = await loadChatDraft(nextHostId, nextSessionId).catch(() => "");
    if (requestId !== draftLoadRequestId || key !== `${hostId}:${sessionId}`) return;

    if (draftEditVersion === editVersion) {
      value = draftText;
    }
    draftLoadedFor = key;
  }

  function submit(mode: "steer" | "follow_up"): void {
    const text = value.trim();
    const send = activeSessionState.send;
    const sentImages = cloneImageContent(images);
    if ((!text && !sentImages) || !send) return;
    const event = {
      t: "send" as const,
      text,
      mode,
      ...(sentImages ? { images: sentImages } : {}),
      clientId: crypto.randomUUID(),
    };
    send(event);
    chatLogState.appendLocalEcho(hostId, sessionId, event);
    value = "";
    cursor = 0;
    images = [];
    textBeforeRecording = "";
    void clearChatDraft(hostId, sessionId);
    haptics.light();
  }

  function interrupt(): void {
    activeSessionState.send?.({ t: "interrupt" });
  }

  async function toggleMic(): Promise<void> {
    if (stt.listening) {
      await stt.stop();
    } else {
      textBeforeRecording = value;
      await stt.start();
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
      haptics.medium();
      submit("follow_up");
    },
  });

  function clearSendPointerListeners(): void {
    window.removeEventListener("pointerup", handleWindowSendPointerUp, { capture: true });
    window.removeEventListener("pointercancel", handleWindowSendPointerCancel, { capture: true });
  }

  function handleSendPointerDown(event: PointerEvent): void {
    if (!hasSendable || !canSend) return;

    // Keep the textarea focused so the native keyboard/WebView layout doesn't
    // move under the finger before the tap completes.
    event.preventDefault();
    clearSendPointerListeners();
    ignoreNextSendClick = false;
    sendPointerId = event.pointerId;
    sendPress.start(event);
    window.addEventListener("pointerup", handleWindowSendPointerUp, { capture: true });
    window.addEventListener("pointercancel", handleWindowSendPointerCancel, { capture: true });
  }

  function finishSendPointer(): void {
    clearSendPointerListeners();
    sendPointerId = null;
    ignoreNextSendClick = true;
    sendPress.end();
    if (sendPress.consumeClick()) return;
    submit("steer");
  }

  function handleWindowSendPointerUp(event: PointerEvent): void {
    if (sendPointerId !== null && event.pointerId !== sendPointerId) return;
    event.preventDefault();
    finishSendPointer();
  }

  function handleWindowSendPointerCancel(event: PointerEvent): void {
    if (sendPointerId !== null && event.pointerId !== sendPointerId) return;
    clearSendPointerListeners();
    sendPointerId = null;
    sendPress.end();
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
    draftEditVersion += 1;
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

  function toggleActions(): void {
    actionsOpen = !actionsOpen;
  }

  async function runAction(action: () => void | Promise<void>): Promise<void> {
    actionsOpen = false;
    await action();
  }

  function addImages(next: readonly ImageContent[]): void {
    const cloned = cloneImageContent(next);
    if (!cloned) return;
    images = [...images, ...cloned].slice(0, MAX_IMAGES);
    draftEditVersion += 1;
  }

  async function attachImages(): Promise<void> {
    try {
      const remaining = MAX_IMAGES - images.length;
      if (remaining <= 0) return;
      addImages(await pickImages({ limit: remaining }));
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
    images = images.filter((_, candidate) => candidate !== index);
    draftEditVersion += 1;
  }

  async function syncQueue(options: { showLoading?: boolean } = {}): Promise<void> {
    const requestId = ++queueRequestId;
    if (options.showLoading) {
      queueLoading = true;
      queueError = null;
    }

    try {
      const next = await runOnHost(hostId, getSessionQueue(sessionId));
      if (requestId !== queueRequestId) return;
      chatQueueState.set(hostId, sessionId, next);
    } catch (error) {
      if (requestId !== queueRequestId || !options.showLoading) return;
      queueError = hostIssueSummary(error);
    } finally {
      if (requestId === queueRequestId && options.showLoading) queueLoading = false;
    }
  }

  function loadQueue(): Promise<void> {
    return syncQueue({ showLoading: true });
  }

  async function clearQueuedMessages(): Promise<void> {
    clearing = true;
    try {
      await runOnHost(hostId, clearSessionQueue(sessionId));
      chatQueueState.clear(hostId, sessionId);
    } finally {
      clearing = false;
    }
  }
</script>

<div class="pointer-events-auto relative z-20 shrink-0" style:padding-bottom={bottomPadding}>
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
        draftEditVersion += 1;
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
      class="type-input w-full resize-none bg-transparent px-3 pt-2 pb-1 text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-faint)] focus:outline-none"
    ></textarea>

    <div class="flex items-center gap-1 px-1.5 pb-1.5">
      <div class="relative shrink-0" data-input-actions>
        {#if actionsOpen}
          <div class="absolute bottom-[calc(100%+0.75rem)] left-0 z-40 flex flex-col gap-1.5">
            {@render ActionFab("Attach image", images.length >= MAX_IMAGES, () => runAction(attachImages), "image")}
            {@render ActionFab("Dictate", stt.available === false, () => runAction(toggleMic), "mic")}
          </div>
        {/if}
        <Button type="button" variant="ghost" size="icon" onpointerdown={(event) => event.preventDefault()} onclick={toggleActions} class="relative rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface-2)]" aria-label="More input actions" title="More input actions" aria-expanded={actionsOpen}>
          {#if actionsOpen}
            <span class="absolute h-7 w-7 rotate-45 rounded-[var(--radius-sm)] bg-[color:var(--color-surface-2)]" aria-hidden="true"></span>
          {/if}
          <Plus class={`relative size-4 transition-transform ${actionsOpen ? "rotate-45" : ""}`} />
        </Button>
      </div>

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
          <span class="absolute right-0.5 top-0.5 flex min-w-4 translate-x-1/3 -translate-y-1/3 items-center justify-center rounded-full border border-[color:var(--color-surface)] bg-[color:var(--color-accent)] px-1 py-0.5 text-[0.625rem] font-medium leading-none text-[color:var(--color-bg)]">
            {queueCount > 99 ? "99+" : queueCount}
          </span>
        </Button>
      {/if}

      {#if stt.listening}
        <Button type="button" size="icon" onclick={toggleMic} class="rounded-[var(--radius-sm)] bg-[color:var(--color-danger)] text-[color:var(--color-bg)] pulse-accent active:opacity-80" aria-label="Stop dictation" title="Stop dictation">
          <MicOff class="size-3.5" />
        </Button>
      {:else}
        {#if busy}
          <Button type="button" variant="outline" size="icon" onclick={interrupt} aria-label="Stop" title="Stop the current turn" class="shrink-0 rounded-[var(--radius-sm)] active:opacity-80">
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
          class={`shrink-0 rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] text-[color:var(--color-bg)] transition-transform duration-100 active:opacity-80 disabled:bg-[color:var(--color-surface-2)] disabled:text-[color:var(--color-fg-faint)] disabled:opacity-100 ${holding ? "scale-95" : ""}`}
          aria-label={busy ? "Steer (hold to queue a follow-up)" : "Send"}
          title={hasSendable ? (activeSessionState.compacting ? "Queue until compaction finishes" : busy ? "Tap to steer · hold to queue a follow-up" : "Send · hold to queue a follow-up") : "Draft a message to send"}
        >
          <ArrowUp class="size-3.5" strokeWidth={2.5} />
        </Button>
      {/if}
    </div>
  </div>

  <CompactContextSheet bind:open={compactOpen} {hostId} {sessionId} />

  <QueuedMessagesSheet
    bind:open={queueOpen}
    {queue}
    loading={queueLoading}
    error={queueError}
    {clearing}
    onLoad={loadQueue}
    onClear={clearQueuedMessages}
  />

  <Sheet.Root bind:open={modelOpen}>
    <Sheet.BottomContent class="max-h-[82dvh]">
      <SheetHeader title="model" />
      <SessionSettingsView {hostId} {sessionId} onError={() => {}} filterKeys={["model"]} />
    </Sheet.BottomContent>
  </Sheet.Root>
</div>

{#snippet ActionFab(label: string, disabled: boolean, onClick: () => void | Promise<void>, icon: "image" | "mic")}
  <button type="button" onpointerdown={(event) => event.preventDefault()} onclick={() => void onClick()} {disabled} class="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-[color:var(--color-bg)] shadow-lg shadow-black/20 backdrop-blur-md active:opacity-85 disabled:border-[color:var(--color-border)] disabled:bg-[color:var(--color-surface)] disabled:text-[color:var(--color-fg-faint)] disabled:opacity-60" aria-label={label} title={label}>
    {#if icon === "image"}<ImagePlus class="size-4" />{:else}<Mic class="size-4" />{/if}
  </button>
{/snippet}
