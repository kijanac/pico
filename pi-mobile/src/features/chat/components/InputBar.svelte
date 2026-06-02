<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { ArrowUp, Hash, ImagePlus, ListTodo, Mic, MicOff, Plus, Square, Trash2 } from "@lucide/svelte";
  import type { ImageAttachment, QueueState } from "@pi-mobile/protocol";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { createSpeechRecognitionState } from "@/shared/mobile/speech.svelte";
  import { pickImages } from "@/shared/mobile/image-picker";
  import { haptics } from "@/shared/mobile/haptics";
  import { createLongPress } from "@/shared/gestures/long-press";
  import { clearSessionQueue, getSessionQueue } from "@/features/chat/api";
  import { clearChatDraft, loadChatDraft, saveChatDraft } from "@/features/chat/model/chat-draft";
  import { Button } from "@/shared/ui/button";
  import * as Sheet from "@/shared/ui/sheet";
  import ImageTray from "@/features/chat/components/ImageTray.svelte";
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
    autoSize();
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

  function autoSize(): void {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }

  async function restoreDraft(id: string): Promise<void> {
    const requestId = ++draftLoadRequestId;
    const editVersion = draftEditVersion;
    draftLoadedFor = null;
    value = "";
    images = [];
    textBeforeRecording = "";
    autoSize();

    const draftText = await loadChatDraft(id).catch(() => "");
    if (requestId !== draftLoadRequestId || id !== sessionId) return;

    if (draftEditVersion === editVersion) {
      value = draftText;
    }
    draftLoadedFor = id;
    autoSize();
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
    autoSize();
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
    autoSize();
    paletteOpen = false;
    void tick().then(() => {
      textarea?.focus();
      const cursor = prefix.length + text.length + (needsSuffixSpace ? 1 : 0);
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  function handleInput(next: string): void {
    draftEditVersion += 1;
    value = next;
    autoSize();
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

  async function openCommands(): Promise<void> {
    actionsOpen = false;
    await tick();
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

  $effect(() => {
    if (queueOpen) void loadQueue();
  });
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
        oninput={(event) => handleInput(event.currentTarget.value)}
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
      <button type="button" onclick={() => { void loadQueue(); queueOpen = true; }} class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]" aria-label="Queued messages" title="Queued messages">
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

  <Sheet.Root bind:open={actionsOpen}>
    <Sheet.Content side="bottom" class="flex max-h-[45dvh] flex-col gap-0 overflow-hidden rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none" style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem)">
      <Sheet.Header class="hairline-b space-y-0 px-3 py-3 pr-12 text-left"><Sheet.Title class="min-w-0 flex-1 px-1 text-[13px] font-medium">add</Sheet.Title></Sheet.Header>
      <div class="grid grid-cols-3 gap-2 px-3 py-3">
        <button type="button" onclick={() => { actionsOpen = false; void attachImages(); }} disabled={images.length >= MAX_IMAGES} class="flex min-h-20 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-center active:bg-[color:var(--color-surface-2)] disabled:opacity-40">
          <ImagePlus class="size-5 text-[color:var(--color-fg-muted)]" />
          <span class="text-[12px] font-medium">image</span>
          <span class="text-[10px] text-[color:var(--color-fg-faint)]">{images.length >= MAX_IMAGES ? `max ${MAX_IMAGES}` : "attach photo"}</span>
        </button>
        <button type="button" onclick={() => { actionsOpen = false; void toggleMic(); }} disabled={stt.available === false} class="flex min-h-20 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-center active:bg-[color:var(--color-surface-2)] disabled:opacity-40">
          <Mic class="size-5 text-[color:var(--color-fg-muted)]" />
          <span class="text-[12px] font-medium">dictate</span>
          <span class="text-[10px] text-[color:var(--color-fg-faint)]">{stt.available === false ? "unavailable" : "speech to text"}</span>
        </button>
        <button type="button" onclick={() => void openCommands()} class="flex min-h-20 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-center active:bg-[color:var(--color-surface-2)]">
          <Hash class="size-5 text-[color:var(--color-fg-muted)]" />
          <span class="text-[12px] font-medium">commands</span>
          <span class="text-[10px] text-[color:var(--color-fg-faint)]">slash palette</span>
        </button>

      </div>
    </Sheet.Content>
  </Sheet.Root>

  <Sheet.Root bind:open={queueOpen}>
    <Sheet.Content side="bottom" class="flex max-h-[75dvh] flex-col gap-0 overflow-hidden rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none" style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem)">
      <Sheet.Header class="hairline-b space-y-0 px-3 py-3 pr-12 text-left"><Sheet.Title class="min-w-0 flex-1 px-1 text-[13px] font-medium">queued messages</Sheet.Title></Sheet.Header>
      <div class="flex-1 overflow-y-auto px-3 py-3">
        {#if queueLoading}<div class="text-[12px] text-[color:var(--color-fg-faint)]">loading queue…</div>{/if}
        {#if queueError}<div class="text-[12px] text-[color:var(--color-danger)]">{queueError}</div>{/if}
        {#if queueState && queueCount === 0}<div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-center text-[12px] text-[color:var(--color-fg-faint)]">no queued messages</div>{/if}
        {#if queueState}
          {@render QueueSection("steering", queueState.steering)}
          {@render QueueSection("follow-up", queueState.followUp)}
        {/if}
      </div>
      {#if queueCount > 0}
        <div class="hairline-t px-3 py-2">
          <Button type="button" variant="destructive" disabled={clearing} onclick={clearQueuedMessages} class="w-full bg-transparent text-[color:var(--color-danger)] hover:bg-[color:var(--color-surface)]">
            <Trash2 class="size-3.5" />
            {clearing ? "clearing…" : "clear queued messages"}
          </Button>
        </div>
      {/if}
    </Sheet.Content>
  </Sheet.Root>
</div>

{#snippet QueueSection(label: string, items: string[])}
  {#if items.length > 0}
    <div class="mb-3">
      <div class="label mb-1.5">{label}</div>
      <div class="space-y-1.5">
        {#each items as item}
          <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[12px] text-[color:var(--color-fg)]">{item}</div>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}
