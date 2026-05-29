import { createSignal, createEffect, createResource, Show, For } from "solid-js";
import { MicOff, Square, ArrowUp, ImagePlus, ListTodo, Trash2, Plus } from "lucide-solid";
import { activeStatus } from "@/stores/sessions";
import { activeSend } from "@/stores/connection";
import { createSpeechRecognition } from "@/lib/speech";
import { chooseFromGallery } from "@/lib/image-picker";
import { haptic } from "@/lib/haptics";
import { createLongPress } from "@/lib/long-press";
import { clearSessionQueue, getSessionQueue } from "@/lib/api";
import { getBridgeUrl } from "@/lib/settings";
import type { ImageAttachment } from "@pi-mobile/protocol";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import SlashPalette from "./SlashPalette";
import ImageTray from "./ImageTray";

const LONG_PRESS_MS = 500;
const MAX_IMAGES = 4;

export default function InputBar(props: { sessionId: string }) {
  let ta: HTMLTextAreaElement | undefined;
  const [value, setValue] = createSignal("");
  const [composing, setComposing] = createSignal(false);
  const [holding, setHolding] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [actionsOpen, setActionsOpen] = createSignal(false);
  const [queueOpen, setQueueOpen] = createSignal(false);
  const [queueRefresh, setQueueRefresh] = createSignal(0);
  const [images, setImages] = createSignal<ImageAttachment[]>([]);

  const stt = createSpeechRecognition();

  let textBeforeRecording = "";
  createEffect(() => {
    if (stt.listening()) {
      const t = stt.transcript();
      const merged = textBeforeRecording
        ? `${textBeforeRecording.trimEnd()} ${t}`
        : t;
      setValue(merged);
      autoSize();
    }
  });

  const busy = () =>
    activeStatus() === "thinking" || activeStatus() === "tool";
  const hasText = () => value().trim().length > 0;
  const hasSendable = () => hasText() || images().length > 0;
  const canSend = () => activeSend() !== null;
  const [queueState] = createResource(
    () => `${props.sessionId}:${queueRefresh()}:${activeStatus()}`,
    async () => {
      const baseUrl = await getBridgeUrl();
      return getSessionQueue(baseUrl, props.sessionId);
    },
  );
  const queueCount = () =>
    (queueState()?.steering.length ?? 0) + (queueState()?.followUp.length ?? 0);
  const refreshQueueCount = () => setQueueRefresh((n) => n + 1);

  function autoSize() {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }

  function submit(mode: "steer" | "follow_up") {
    const v = value().trim();
    const imgs = images();
    const send = activeSend();
    if ((!v && imgs.length === 0) || !send) return;
    const queued = busy();
    send({
      t: "send",
      text: v,
      mode,
      ...(imgs.length > 0 ? { images: imgs } : {}),
    });
    setValue("");
    setImages([]);
    textBeforeRecording = "";
    autoSize();
    if (queued) window.setTimeout(refreshQueueCount, 120);
    haptic.light();
  }

  function interrupt() {
    activeSend()?.({ t: "interrupt" });
  }

  async function toggleMic() {
    if (stt.listening()) {
      await stt.stop();
    } else {
      textBeforeRecording = value();
      await stt.start();
    }
  }

  function insertCommand(text: string) {
    const current = value();
    const slash = current.lastIndexOf("/");
    const before = slash >= 0 ? current.slice(0, slash) : current;
    const prefix = before.length === 0 || /\s$/.test(before) ? before : `${before} `;
    setValue(prefix + text);
    autoSize();
    setPaletteOpen(false);
    queueMicrotask(() => ta?.focus());
  }

  function handleInput(next: string) {
    setValue(next);
    autoSize();

    const slash = next.lastIndexOf("/");
    if (slash < 0) return;

    const before = slash === 0 ? "" : next[slash - 1];
    const token = next.slice(slash);
    if ((slash === 0 || /\s/.test(before)) && !/\s/.test(token.slice(1))) {
      setPaletteOpen(true);
    }
  }

  const sendPress = createLongPress({
    delayMs: LONG_PRESS_MS,
    enabled: () => hasSendable() && canSend(),
    onStart: () => setHolding(true),
    onCancel: () => setHolding(false),
    onLongPress: () => {
      haptic.medium();
      submit("follow_up");
    },
  });

  function handleClick() {
    if (sendPress.consumeClick()) return;
    submit("steer");
  }

  async function pickImages() {
    try {
      const remaining = MAX_IMAGES - images().length;
      if (remaining <= 0) return;
      const picked = await chooseFromGallery({ limit: remaining });
      if (picked.length > 0) {
        setImages((prev) => [...prev, ...picked].slice(0, MAX_IMAGES));
      }
    } catch (e) {
      console.warn("[input-bar] image pick failed:", e);
    }
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div
      class="hairline-t sticky bottom-0 z-20 bg-[color:var(--color-bg)]/95 backdrop-blur-md"
      style={{ "padding-bottom": "env(safe-area-inset-bottom)" }}
    >
      <ImageTray images={images()} onRemove={removeImage} />

      <div class="flex items-start gap-1.5 px-2 py-2">
        <button
          type="button"
          onClick={() => {
            refreshQueueCount();
            setActionsOpen(true);
          }}
          class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
          aria-label="More input actions"
          title="More input actions"
        >
          <Plus size={15} />
          <Show when={queueCount() > 0}>
            <span class="absolute right-0.5 top-0.5 flex min-w-4 translate-x-1/3 -translate-y-1/3 items-center justify-center rounded-full border border-[color:var(--color-bg)] bg-[color:var(--color-accent)] px-1 py-0.5 text-[9px] font-medium leading-none text-[color:var(--color-bg)]">
              {queueCount() > 99 ? "99+" : queueCount()}
            </span>
          </Show>
        </button>

        <div class="min-h-9 flex-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] focus-within:border-[color:var(--color-border-strong)]">
          <textarea
            ref={ta}
            value={value()}
            onInput={(e) => handleInput(e.currentTarget.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !composing()) {
                e.preventDefault();
                submit("steer");
              }
            }}
            rows="1"
            class="w-full resize-none bg-transparent px-3 py-[7px] text-[13px] leading-[20px] text-[color:var(--color-fg)] focus:outline-none"
          />
        </div>

        <Show
          when={stt.listening()}
          fallback={
            <>
              <Show when={busy()}>
                <Button
                  type="button"
                  size="icon"
                  variant="default"
                  onClick={interrupt}
                  aria-label="Stop"
                  title="Stop the current turn"
                  class="bg-[color:var(--color-fg)] text-[color:var(--color-bg)] hover:bg-[color:var(--color-fg)] active:opacity-80"
                >
                  <Square size={11} fill="currentColor" />
                </Button>
              </Show>

              <Button
                type="button"
                size="icon"
                variant="default"
                onClick={handleClick}
                onPointerDown={(e) => sendPress.start(e)}
                onPointerUp={sendPress.end}
                onPointerLeave={sendPress.end}
                onPointerCancel={sendPress.end}
                disabled={!hasSendable() || !canSend()}
                classList={{
                  "scale-95": holding(),
                }}
                class="rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] text-[color:var(--color-bg)] transition-transform duration-100 hover:bg-[color:var(--color-accent)] active:opacity-80 disabled:bg-[color:var(--color-surface)] disabled:text-[color:var(--color-fg-faint)] disabled:opacity-100"
                aria-label={busy() ? "Queue message (hold to follow-up)" : "Send"}
                title={
                  hasSendable()
                    ? busy()
                      ? "Tap to steer · hold to queue follow-up"
                      : "Send (hold to queue as follow-up)"
                    : "Draft a message to send"
                }
              >
                <ArrowUp size={14} strokeWidth={2.5} />
              </Button>
            </>
          }
        >
          <Button
            type="button"
            size="icon"
            onClick={toggleMic}
            class="rounded-[var(--radius-sm)] bg-[color:var(--color-danger)] text-[color:var(--color-bg)] pulse-accent active:opacity-80"
            aria-label="Stop dictation"
            title="Stop dictation"
          >
            <MicOff size={14} />
          </Button>
        </Show>
      </div>

      <SlashPalette
        open={paletteOpen()}
        sessionId={props.sessionId}
        onCancel={() => setPaletteOpen(false)}
        onPick={insertCommand}
      />
      <InputActionsSheet
        open={actionsOpen()}
        queueCount={queueCount()}
        imagesFull={images().length >= MAX_IMAGES}
        maxImages={MAX_IMAGES}
        onAttachImage={() => {
          setActionsOpen(false);
          void pickImages();
        }}
        onOpenQueue={() => {
          setActionsOpen(false);
          refreshQueueCount();
          setQueueOpen(true);
        }}
        onClose={() => setActionsOpen(false)}
      />
      <QueueSheet
        open={queueOpen()}
        sessionId={props.sessionId}
        onChanged={refreshQueueCount}
        onClose={() => {
          setQueueOpen(false);
          refreshQueueCount();
        }}
      />
    </div>
  );
}

function InputActionsSheet(props: {
  open: boolean;
  queueCount: number;
  imagesFull: boolean;
  maxImages: number;
  onAttachImage: () => void;
  onOpenQueue: () => void;
  onClose: () => void;
}) {
  function handleOpenChange(open: boolean) {
    if (!open) props.onClose();
  }

  return (
    <Show when={props.open}>
      <Sheet open onOpenChange={handleOpenChange}>
        <SheetContent
          position="bottom"
          class="flex flex-col !max-h-[45dvh] !overflow-hidden gap-0 rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none"
          style={{ "padding-bottom": "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
        >
          <SheetHeader class="hairline-b space-y-0 px-3 py-3 pr-12 text-left">
            <SheetTitle class="min-w-0 flex-1 px-1 text-[13px] font-medium">add</SheetTitle>
          </SheetHeader>
          <div class="grid grid-cols-2 gap-2 px-3 py-3">
          <button
            type="button"
            onClick={props.onAttachImage}
            disabled={props.imagesFull}
            class="flex min-h-20 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-center active:bg-[color:var(--color-surface-2)] disabled:opacity-40"
          >
            <ImagePlus size={18} class="text-[color:var(--color-fg-muted)]" />
            <span class="text-[12px] font-medium">image</span>
            <span class="text-[10px] text-[color:var(--color-fg-faint)]">
              {props.imagesFull ? `max ${props.maxImages}` : "attach photo"}
            </span>
          </button>

          <button
            type="button"
            onClick={props.onOpenQueue}
            class="flex min-h-20 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-center active:bg-[color:var(--color-surface-2)]"
          >
            <span class="relative">
              <ListTodo size={18} class="text-[color:var(--color-fg-muted)]" />
              <Show when={props.queueCount > 0}>
                <span class="absolute -right-2 -top-2 flex min-w-4 items-center justify-center rounded-full bg-[color:var(--color-accent)] px-1 py-0.5 text-[9px] font-medium leading-none text-[color:var(--color-bg)]">
                  {props.queueCount > 99 ? "99+" : props.queueCount}
                </span>
              </Show>
            </span>
            <span class="text-[12px] font-medium">queue</span>
            <span class="text-[10px] text-[color:var(--color-fg-faint)]">
              {props.queueCount > 0 ? `${props.queueCount} pending` : "empty"}
            </span>
          </button>
          </div>
        </SheetContent>
      </Sheet>
    </Show>
  );
}

function QueueSheet(props: {
  open: boolean;
  sessionId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [refresh, setRefresh] = createSignal(0);
  const [clearing, setClearing] = createSignal(false);
  const [queue] = createResource(
    () => (props.open ? `${props.sessionId}:${refresh()}` : null),
    async () => {
      const baseUrl = await getBridgeUrl();
      return getSessionQueue(baseUrl, props.sessionId);
    },
  );
  const total = () => (queue()?.steering.length ?? 0) + (queue()?.followUp.length ?? 0);

  async function clearQueuedMessages() {
    setClearing(true);
    try {
      const baseUrl = await getBridgeUrl();
      await clearSessionQueue(baseUrl, props.sessionId);
      setRefresh((n) => n + 1);
      props.onChanged();
    } finally {
      setClearing(false);
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) props.onClose();
  }

  return (
    <Show when={props.open}>
      <Sheet open onOpenChange={handleOpenChange}>
        <SheetContent
          position="bottom"
          class="flex flex-col !max-h-[75dvh] !overflow-hidden gap-0 rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none"
          style={{ "padding-bottom": "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
        >
          <SheetHeader class="hairline-b space-y-0 px-3 py-3 pr-12 text-left">
            <SheetTitle class="min-w-0 flex-1 px-1 text-[13px] font-medium">queued messages</SheetTitle>
          </SheetHeader>
          <div class="flex-1 overflow-y-auto px-3 py-3">
          <Show when={queue.loading}>
            <div class="text-[12px] text-[color:var(--color-fg-faint)]">loading queue…</div>
          </Show>
          <Show when={queue.error}>
            <div class="text-[12px] text-[color:var(--color-danger)]">{String(queue.error)}</div>
          </Show>
          <Show when={queue() && total() === 0}>
            <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-center text-[12px] text-[color:var(--color-fg-faint)]">no queued messages</div>
          </Show>
          <Show when={queue()}>
            {(q) => (
              <div class="space-y-3">
                <QueueSection label="steering" items={q().steering} />
                <QueueSection label="follow-up" items={q().followUp} />
              </div>
            )}
          </Show>
        </div>
        <Show when={total() > 0}>
          <div class="hairline-t px-3 py-2">
            <Button
              type="button"
              variant="destructive"
              disabled={clearing()}
              onClick={clearQueuedMessages}
              class="w-full bg-transparent text-[color:var(--color-danger)] hover:bg-[color:var(--color-surface)]"
            >
              <Trash2 size={13} />
              {clearing() ? "clearing…" : "clear queued messages"}
            </Button>
          </div>
        </Show>
        </SheetContent>
      </Sheet>
    </Show>
  );
}

function QueueSection(props: { label: string; items: string[] }) {
  return (
    <Show when={props.items.length > 0}>
      <div>
        <div class="label mb-1.5">{props.label}</div>
        <div class="space-y-1.5">
          <For each={props.items}>
            {(item) => (
              <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[12px] text-[color:var(--color-fg)]">
                {item}
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
