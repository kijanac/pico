<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { Archive, ArrowUp, ImagePlus, ListTodo, Mic, MicOff, Plus, Square } from "@lucide/svelte";
  import type { ImageAttachment } from "@pico/protocol";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
  import { chatQueueState } from "@/features/chat/model/chat-queue.state.svelte";
  import { createSpeechRecognitionState } from "@/shared/mobile/speech.svelte";
  import { pickImages } from "@/shared/mobile/image-picker";
  import { haptics } from "@/shared/mobile/haptics";
  import { createLongPress } from "@/shared/gestures/long-press";
  import { clearSessionQueue, getSessionQueue } from "@/features/chat/api";
  import { runHost } from "@/shared/lib/rpc-client";
  import { clearChatDraft, loadChatDraft, saveChatDraft } from "@/features/chat/model/chat-draft";
  import { Button } from "@/shared/ui/button";
  import ImageTray from "@/features/chat/components/ImageTray.svelte";
  import CompactContextSheet from "@/features/chat/components/CompactContextSheet.svelte";
  import QueuedMessagesSheet from "@/features/chat/components/QueuedMessagesSheet.svelte";
  import SlashCommandSuggestions from "@/features/chat/components/SlashCommandSuggestions.svelte";
  import { createSlashCommandsState, type CommandEntry, type SlashCommandCompletion } from "@/features/chat/components/slash-commands.state.svelte";

  const LONG_PRESS_MS = 500;
  const MAX_IMAGES = 4;
  const DRAFT_SAVE_DELAY_MS = 350;

  let { sessionId }: { sessionId: string } = $props();

  let textarea = $state<HTMLTextAreaElement | null>(null);
  let value = $state("");
  let cursor = $state(0);
  let composing = $state(false);
  let holding = $state(false);
  let actionsOpen = $state(false);
  let compactOpen = $state(false);
  let queueOpen = $state(false);
  let images = $state<ImageAttachment[]>([]);
  let queueLoading = $state(false);
  let queueError = $state<string | null>(null);
  let clearing = $state(false);
  let queueRequestId = 0;
  let draftLoadRequestId = 0;
  let draftLoadedFor = $state<string | null>(null);
  let draftEditVersion = 0;

  const stt = createSpeechRecognitionState();
  const slashCommands = createSlashCommandsState(
    () => sessionId,
    () => value,
    () => cursor,
  );
  let textBeforeRecording = "";

  onMount(() => {
    void stt.checkAvailability();
  });

  onDestroy(() => {
    stt.destroy();
  });

  const busy = $derived(activeSessionState.status === "thinking" || activeSessionState.status === "tool");
  const hasText = $derived(value.trim().length > 0);
  const hasSendable = $derived(hasText || images.length > 0);
  const canSend = $derived(activeSessionState.send !== null);
  const queue = $derived(chatQueueState.get(sessionId));
  const queueCount = $derived(chatQueueState.count(sessionId));

  $effect(() => {
    if (!stt.listening) return;
    const transcript = stt.transcript;
    draftEditVersion += 1;
    value = textBeforeRecording ? `${textBeforeRecording.trimEnd()} ${transcript}` : transcript;
  });

  $effect(() => {
    const id = sessionId;
    untrack(() => {
      void restoreDraft(id);
      void syncQueue();
    });
  });

  $effect(() => {
    const id = sessionId;
    const draftText = value;
    if (draftLoadedFor !== id) return;

    const timer = window.setTimeout(() => {
      void saveChatDraft(id, draftText);
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

  async function restoreDraft(id: string): Promise<void> {
    const requestId = ++draftLoadRequestId;
    const editVersion = draftEditVersion;
    draftLoadedFor = null;
    value = "";
    cursor = 0;
    images = [];
    textBeforeRecording = "";

    const draftText = await loadChatDraft(id).catch(() => "");
    if (requestId !== draftLoadRequestId || id !== sessionId) return;

    if (draftEditVersion === editVersion) {
      value = draftText;
    }
    draftLoadedFor = id;
  }

  function submit(mode: "steer" | "follow_up"): void {
    const text = value.trim();
    const send = activeSessionState.send;
    if ((!text && images.length === 0) || !send) return;
    const event = {
      t: "send" as const,
      text,
      mode,
      ...(images.length > 0 ? { images } : {}),
      clientId: crypto.randomUUID(),
    };
    send(event);
    if (text) chatLogState.appendLocalEcho(sessionId, event);
    value = "";
    cursor = 0;
    images = [];
    textBeforeRecording = "";
    void clearChatDraft(sessionId);
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

  const sendPress = createLongPress({
    delayMs: LONG_PRESS_MS,
    enabled: () => hasSendable && canSend,
    onStart: () => (holding = true),
    onCancel: () => (holding = false),
    onLongPress: () => {
      haptics.medium();
      submit("follow_up");
    },
  });

  function handleSendClick(): void {
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

  function openCompactSheet(): void {
    compactOpen = true;
  }

  async function attachImages(): Promise<void> {
    try {
      const remaining = MAX_IMAGES - images.length;
      if (remaining <= 0) return;
      const picked = await pickImages({ limit: remaining });
      if (picked.length > 0) images = [...images, ...picked].slice(0, MAX_IMAGES);
    } catch (error) {
      console.warn("[input-bar] image pick failed:", error);
    }
  }

  function removeImage(index: number): void {
    images = images.filter((_, candidate) => candidate !== index);
  }

  async function syncQueue(options: { showLoading?: boolean } = {}): Promise<void> {
    const requestId = ++queueRequestId;
    if (options.showLoading) {
      queueLoading = true;
      queueError = null;
    }

    try {
      const next = await runHost(getSessionQueue(sessionId));
      if (requestId !== queueRequestId) return;
      chatQueueState.set(sessionId, next);
    } catch (error) {
      if (requestId !== queueRequestId || !options.showLoading) return;
      queueError = String(error);
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
      await runHost(clearSessionQueue(sessionId));
      chatQueueState.clear(sessionId);
    } finally {
      clearing = false;
    }
  }

</script>

<div class="hairline-t sticky bottom-0 z-20 bg-[color:var(--color-bg)]/95 backdrop-blur-md" style="padding-bottom: env(safe-area-inset-bottom)">
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

  <div class="flex items-start gap-1.5 px-2 py-2">
    <div class="relative shrink-0" data-input-actions>
      {#if actionsOpen}
        <div class="absolute bottom-[calc(100%+0.75rem)] left-0 z-40 flex flex-col gap-1.5">
          {@render ActionFab("Compact context", activeSessionState.compacting, () => runAction(openCompactSheet), "compact")}
          {@render ActionFab("Attach image", images.length >= MAX_IMAGES, () => runAction(attachImages), "image")}
          {@render ActionFab("Dictate", stt.available === false, () => runAction(toggleMic), "mic")}
        </div>
      {/if}
      <Button type="button" variant="ghost" size="icon-lg" onpointerdown={(event) => event.preventDefault()} onclick={toggleActions} class="relative rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]" aria-label="More input actions" title="More input actions" aria-expanded={actionsOpen}>
        {#if actionsOpen}
          <span class="absolute h-7 w-7 rotate-45 rounded-[var(--radius-sm)] bg-[color:var(--color-surface)]" aria-hidden="true"></span>
        {/if}
        <Plus class={`relative size-4 transition-transform ${actionsOpen ? "rotate-45" : ""}`} />
      </Button>
    </div>

    <div class="min-h-9 flex-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] focus-within:border-[color:var(--color-border-strong)]">
      <textarea
        bind:this={textarea}
        bind:value
        use:autosize={value}
        oninput={(event) => {
          draftEditVersion += 1;
          updateCursor(event.currentTarget);
        }}
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
        class="type-input w-full resize-none bg-transparent px-3 py-[7px] text-[color:var(--color-fg)] focus:outline-none"
      ></textarea>
    </div>

    {#if queueCount > 0}
      <Button type="button" variant="ghost" size="icon-lg" onclick={() => (queueOpen = true)} class="relative shrink-0 rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]" aria-label="Queued messages" title="Queued messages">
        <ListTodo class="size-4" />
        <span class="absolute right-0.5 top-0.5 flex min-w-4 translate-x-1/3 -translate-y-1/3 items-center justify-center rounded-full border border-[color:var(--color-bg)] bg-[color:var(--color-accent)] px-1 py-0.5 text-[0.625rem] font-medium leading-none text-[color:var(--color-bg)]">
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
        <Button type="button" size="icon" onclick={interrupt} aria-label="Stop" title="Stop the current turn" class="bg-[color:var(--color-fg)] text-[color:var(--color-bg)] hover:bg-[color:var(--color-fg)] active:opacity-80">
          <Square class="size-3" fill="currentColor" />
        </Button>
      {/if}
      <Button
        type="button"
        size="icon"
        onclick={handleSendClick}
        onpointerdown={(event) => sendPress.start(event)}
        onpointerup={sendPress.end}
        onpointerleave={sendPress.end}
        onpointercancel={sendPress.end}
        disabled={!hasSendable || !canSend}
        class={`rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] text-[color:var(--color-bg)] transition-transform duration-100 hover:bg-[color:var(--color-accent)] active:opacity-80 disabled:bg-[color:var(--color-surface)] disabled:text-[color:var(--color-fg-faint)] disabled:opacity-100 ${holding ? "scale-95" : ""}`}
        aria-label={busy ? "Queue message (hold to follow-up)" : "Send"}
        title={hasSendable ? (activeSessionState.compacting ? "Queue until compaction finishes" : busy ? "Tap to steer · hold to queue follow-up" : "Send (hold to queue as follow-up)") : "Draft a message to send"}
      >
        <ArrowUp class="size-3.5" strokeWidth={2.5} />
      </Button>
    {/if}
  </div>

  <CompactContextSheet bind:open={compactOpen} {sessionId} />

  <QueuedMessagesSheet
    bind:open={queueOpen}
    {queue}
    loading={queueLoading}
    error={queueError}
    {clearing}
    onLoad={loadQueue}
    onClear={clearQueuedMessages}
  />
</div>

{#snippet ActionFab(label: string, disabled: boolean, onClick: () => void | Promise<void>, icon: "compact" | "image" | "mic")}
  <button type="button" onpointerdown={(event) => event.preventDefault()} onclick={() => void onClick()} {disabled} class="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-[color:var(--color-bg)] shadow-lg shadow-black/20 backdrop-blur-md active:opacity-85 disabled:border-[color:var(--color-border)] disabled:bg-[color:var(--color-surface)] disabled:text-[color:var(--color-fg-faint)] disabled:opacity-60" aria-label={label} title={label}>
    {#if icon === "compact"}<Archive class="size-4" />{:else if icon === "image"}<ImagePlus class="size-4" />{:else}<Mic class="size-4" />{/if}
  </button>
{/snippet}
