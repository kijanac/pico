<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { ArrowUp, ListTodo, MicOff, Plus, Square } from "@lucide/svelte";
  import type { ImageAttachment, QueueState } from "@pi-mobile/protocol";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { createSpeechRecognitionState } from "@/shared/mobile/speech.svelte";
  import { pickImages } from "@/shared/mobile/image-picker";
  import { haptics } from "@/shared/mobile/haptics";
  import { createLongPress } from "@/shared/gestures/long-press";
  import { clearSessionQueue, getSessionQueue } from "@/features/chat/api";
  import { clearChatDraft, loadChatDraft, saveChatDraft } from "@/features/chat/model/chat-draft";
  import { Button } from "@/shared/ui/button";
  import ImageTray from "@/features/chat/components/ImageTray.svelte";
  import InputAddSheet from "@/features/chat/components/InputAddSheet.svelte";
  import QueuedMessagesSheet from "@/features/chat/components/QueuedMessagesSheet.svelte";
  import SlashPalette from "@/features/chat/components/SlashPalette.svelte";

  const LONG_PRESS_MS = 500;
  const MAX_IMAGES = 4;
  const DRAFT_SAVE_DELAY_MS = 350;

  let { sessionId }: { sessionId: string } = $props();

  let textarea = $state<HTMLTextAreaElement | null>(null);
  let value = $state("");
  let composing = $state(false);
  let holding = $state(false);
  let paletteOpen = $state(false);
  let actionsOpen = $state(false);
  let queueOpen = $state(false);
  let images = $state<ImageAttachment[]>([]);
  let queueState = $state<QueueState | null>(null);
  let queueLoading = $state(false);
  let queueError = $state<string | null>(null);
  let clearing = $state(false);
  let queueRequestId = 0;
  let draftLoadRequestId = 0;
  let draftLoadedFor = $state<string | null>(null);
  let draftEditVersion = 0;

  const stt = createSpeechRecognitionState();
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
  const queueCount = $derived((queueState?.steering.length ?? 0) + (queueState?.followUp.length ?? 0));

  $effect(() => {
    if (!stt.listening) return;
    const transcript = stt.transcript;
    draftEditVersion += 1;
    value = textBeforeRecording ? `${textBeforeRecording.trimEnd()} ${transcript}` : transcript;
  });

  $effect(() => {
    activeSessionState.status;
    void refreshQueueCount();
  });

  $effect(() => {
    const id = sessionId;
    untrack(() => void restoreDraft(id));
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

  function autosize(node: HTMLTextAreaElement, _value: string) {
    const resize = () => {
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
    };

    resize();
    return { update: resize };
  }

  async function restoreDraft(id: string): Promise<void> {
    const requestId = ++draftLoadRequestId;
    const editVersion = draftEditVersion;
    draftLoadedFor = null;
    value = "";
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
    const queued = busy;
    send({
      t: "send",
      text,
      mode,
      ...(images.length > 0 ? { images } : {}),
    });
    value = "";
    images = [];
    textBeforeRecording = "";
    void clearChatDraft(sessionId);
    if (queued) window.setTimeout(() => void refreshQueueCount(), 120);
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

  function insertCommand(text: string): void {
    draftEditVersion += 1;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const prefix = before.length === 0 || /\s$/.test(before) ? before : `${before} `;
    const needsSuffixSpace = after.length > 0 && !/^\s/.test(after) && !/\s$/.test(text);
    const suffix = needsSuffixSpace ? ` ${after}` : after;
    value = `${prefix}${text}${suffix}`;
    paletteOpen = false;
    void tick().then(() => {
      textarea?.focus();
      const cursor = prefix.length + text.length + (needsSuffixSpace ? 1 : 0);
      textarea?.setSelectionRange(cursor, cursor);
    });
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

  function openCommands(): void {
    paletteOpen = true;
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

  async function refreshQueueCount(): Promise<void> {
    const requestId = ++queueRequestId;
    try {
      const next = await getSessionQueue(sessionId);
      if (requestId === queueRequestId) queueState = next;
    } catch {
    }
  }

  async function loadQueue(): Promise<void> {
    const requestId = ++queueRequestId;
    queueLoading = true;
    queueError = null;
    try {
      const next = await getSessionQueue(sessionId);
      if (requestId !== queueRequestId) return;
      queueState = next;
    } catch (error) {
      if (requestId !== queueRequestId) return;
      queueError = String(error);
    } finally {
      if (requestId === queueRequestId) queueLoading = false;
    }
  }

  async function clearQueuedMessages(): Promise<void> {
    clearing = true;
    try {
      queueState = await clearSessionQueue(sessionId);
      await refreshQueueCount();
    } finally {
      clearing = false;
    }
  }

</script>

<div class="hairline-t sticky bottom-0 z-20 bg-[color:var(--color-bg)]/95 backdrop-blur-md" style="padding-bottom: env(safe-area-inset-bottom)">
  <ImageTray {images} onRemove={removeImage} />

  <div class="flex items-start gap-1.5 px-2 py-2">
    <button type="button" onclick={() => { void refreshQueueCount(); actionsOpen = true; }} class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]" aria-label="More input actions" title="More input actions">
      <Plus class="size-4" />
    </button>

    <div class="min-h-9 flex-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] focus-within:border-[color:var(--color-border-strong)]">
      <textarea
        bind:this={textarea}
        bind:value
        use:autosize={value}
        oninput={() => (draftEditVersion += 1)}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => (composing = false)}
        onkeydown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !composing) {
            event.preventDefault();
            submit("steer");
          }
        }}
        rows="1"
        class="w-full resize-none bg-transparent px-3 py-[7px] text-[13px] leading-[20px] text-[color:var(--color-fg)] focus:outline-none"
      ></textarea>
    </div>

    {#if queueCount > 0}
      <button type="button" onclick={() => (queueOpen = true)} class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]" aria-label="Queued messages" title="Queued messages">
        <ListTodo class="size-4" />
        <span class="absolute right-0.5 top-0.5 flex min-w-4 translate-x-1/3 -translate-y-1/3 items-center justify-center rounded-full border border-[color:var(--color-bg)] bg-[color:var(--color-accent)] px-1 py-0.5 text-[9px] font-medium leading-none text-[color:var(--color-bg)]">
          {queueCount > 99 ? "99+" : queueCount}
        </span>
      </button>
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
        title={hasSendable ? (busy ? "Tap to steer · hold to queue follow-up" : "Send (hold to queue as follow-up)") : "Draft a message to send"}
      >
        <ArrowUp class="size-3.5" strokeWidth={2.5} />
      </Button>
    {/if}
  </div>

  <SlashPalette bind:open={paletteOpen} {sessionId} onPick={insertCommand} />

  <InputAddSheet
    bind:open={actionsOpen}
    imageCount={images.length}
    maxImages={MAX_IMAGES}
    speechAvailable={stt.available}
    onAttachImages={attachImages}
    onToggleMic={toggleMic}
    onOpenCommands={openCommands}
  />

  <QueuedMessagesSheet
    bind:open={queueOpen}
    queue={queueState}
    loading={queueLoading}
    error={queueError}
    {clearing}
    onLoad={loadQueue}
    onClear={clearQueuedMessages}
  />
</div>
