import { createSignal, createEffect, Show, type JSX } from "solid-js";
import { Mic, MicOff, Square, ArrowUp, Slash, ImagePlus } from "lucide-solid";
import { activeStatus } from "~/stores/sessions";
import { activeSend } from "~/stores/connection";
import { createSpeechRecognition } from "~/lib/speech";
import { chooseFromGallery } from "~/lib/image-picker";
import { haptic } from "~/lib/haptics";
import type { ImageAttachment } from "@pi-mobile/protocol";
import SlashPalette from "./SlashPalette";
import ImageTray from "./ImageTray";

/**
 * Long-press threshold for the send button.
 *
 *   tap   → mode "steer"     (queue after current turn's tools finish)
 *   hold  → mode "follow_up" (queue after the agent settles entirely)
 *
 * The bridge ignores mode when the agent is idle — it just starts a new
 * turn — so the same buttons work whether or not pi is streaming.
 */
const LONG_PRESS_MS = 500;
const MAX_IMAGES = 4;

export default function InputBar(): JSX.Element {
  let ta: HTMLTextAreaElement | undefined;
  const [value, setValue] = createSignal("");
  const [composing, setComposing] = createSignal(false);
  const [holding, setHolding] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [images, setImages] = createSignal<ImageAttachment[]>([]);

  // Speech-to-text. Available on native (iOS/Android) only; on web the
  // mic button is hidden.
  const stt = createSpeechRecognition();

  // While listening, the live transcript replaces the textarea content.
  // We remember the pre-recording text and concatenate, so users can dictate
  // an addendum without losing what they'd already typed.
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
  // Images alone count as sendable content — image-only messages are a
  // valid pi prompt (e.g. "what's in this screenshot?" with the user's
  // intent implicit). The send button and submit guards both follow.
  const hasSendable = () => hasText() || images().length > 0;
  const canSend = () => activeSend() !== null;

  function autoSize() {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }

  function submit(mode: "steer" | "follow_up") {
    const v = value().trim();
    const imgs = images();
    const send = activeSend();
    // Allow sending images alone (no text), but not nothing.
    if ((!v && imgs.length === 0) || !send) return;
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
    haptic.light();
  }

  function interrupt() {
    activeSend()?.({ t: "interrupt" });
  }

  /**
   * Toggle dictation. While listening, partial results flow into the
   * textarea (concatenated with any text that was there when recording
   * started). Tap again to stop — the transcript stays in the textarea
   * so the user can edit or send normally.
   */
  async function toggleMic() {
    if (stt.listening()) {
      await stt.stop();
      // textBeforeRecording is left as-is; clearing happens on submit
    } else {
      textBeforeRecording = value();
      await stt.start();
    }
  }

  /**
   * Insert a slash command at the end of the current input, then focus
   * the textarea. For commands that take args, the server adds a
   * trailing space so the user can start typing immediately.
   */
  function insertCommand(text: string) {
    const current = value();
    // If empty or ends with whitespace, just append. Otherwise add a space.
    const prefix =
      current.length === 0 || /\s$/.test(current) ? current : `${current} `;
    setValue(prefix + text);
    autoSize();
    setPaletteOpen(false);
    // Defer focus to after the sheet's close animation
    queueMicrotask(() => ta?.focus());
  }

  /* ── long-press machinery ──
     onPointerDown starts a timer; if it fires before pointerup, we
     submit follow_up and mark `longFired`. The subsequent click event
     (synthesized from the touch) checks the flag and ignores. */
  let pressTimer: number | undefined;
  let longFired = false;

  function pointerDown() {
    if (!hasSendable() || !canSend()) return;
    longFired = false;
    setHolding(true);
    pressTimer = window.setTimeout(() => {
      longFired = true;
      pressTimer = undefined;
      setHolding(false);
      // Medium thunk to signal the threshold crossed before the submit's
      // light tap — produces a recognizable "ka-tap" pattern only the
      // long-press path emits.
      haptic.medium();
      submit("follow_up");
    }, LONG_PRESS_MS);
  }

  function pointerEnd() {
    setHolding(false);
    if (pressTimer !== undefined) {
      window.clearTimeout(pressTimer);
      pressTimer = undefined;
    }
  }

  function handleClick() {
    if (longFired) {
      // Long-press already submitted; swallow the synthesized click.
      longFired = false;
      return;
    }
    submit("steer");
  }

  /**
   * Open the gallery picker. Native: shows the OS photo picker; web:
   * shows the browser file chooser. Picked images are appended to the
   * tray (subject to MAX_IMAGES); failures are logged and silently
   * swallowed so a deny / cancel doesn't surface as an error.
   */
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
      class="hairline-t sticky bottom-0 bg-[color:var(--color-bg)]/95 backdrop-blur-md"
      style={{ "padding-bottom": "env(safe-area-inset-bottom)" }}
    >
      <ImageTray images={images()} onRemove={removeImage} />

      <div class="flex items-end gap-1.5 px-2 py-2">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
          aria-label="Slash command"
          title="Insert a slash command"
        >
          <Slash size={14} />
        </button>

        <button
          type="button"
          onClick={pickImages}
          disabled={images().length >= MAX_IMAGES}
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)] disabled:opacity-40"
          aria-label="Attach image"
          title={
            images().length >= MAX_IMAGES
              ? `Up to ${MAX_IMAGES} images per message`
              : "Attach an image"
          }
        >
          <ImagePlus size={14} />
        </button>

        <div class="flex-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] focus-within:border-[color:var(--color-border-strong)]">
          <textarea
            ref={ta}
            value={value()}
            onInput={(e) => {
              setValue(e.currentTarget.value);
              autoSize();
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !composing()) {
                e.preventDefault();
                submit("steer");
              }
            }}
            placeholder="message pi…"
            rows="1"
            class="w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-[1.5] text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-faint)] focus:outline-none"
          />
        </div>

        {/* Trailing button stack — precedence rules:
            1. Listening (recording dictation): show Mic stop button. Wins
               over everything so the user can always stop.
            2. Busy (agent generating): show Stop. If hasText, also show
               Send so the user can queue a steering/follow-up message.
            3. Idle + has text: show Send.
            4. Idle + no text + STT available: show Mic (start dictation).
            5. Else: nothing. */}
        <Show when={stt.listening()}>
          <button
            type="button"
            onClick={toggleMic}
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[color:var(--color-danger)] text-[color:var(--color-bg)] pulse-accent active:opacity-80"
            aria-label="Stop dictation"
            title="Stop dictation"
          >
            <MicOff size={14} />
          </button>
        </Show>

        <Show when={!stt.listening() && busy()}>
          <button
            type="button"
            onClick={interrupt}
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[color:var(--color-fg)] text-[color:var(--color-bg)] active:opacity-80"
            aria-label="Stop"
            title="Stop the current turn"
          >
            <Square size={11} fill="currentColor" />
          </button>
        </Show>

        <Show
          when={!stt.listening() && hasSendable()}
          fallback={
            <Show
              when={
                !stt.listening() &&
                !busy() &&
                !hasSendable() &&
                stt.available() === true
              }
            >
              <button
                type="button"
                onClick={toggleMic}
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
                aria-label="Voice input"
                title="Tap to dictate"
              >
                <Mic size={14} />
              </button>
            </Show>
          }
        >
          <button
            type="button"
            onClick={handleClick}
            onPointerDown={pointerDown}
            onPointerUp={pointerEnd}
            onPointerLeave={pointerEnd}
            onPointerCancel={pointerEnd}
            disabled={!canSend()}
            classList={{
              "scale-95": holding(),
            }}
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] text-[color:var(--color-bg)] transition-transform duration-100 active:opacity-80 disabled:opacity-40"
            aria-label={busy() ? "Queue message (hold to follow-up)" : "Send"}
            title={
              busy()
                ? "Tap to steer · hold to queue follow-up"
                : "Send (hold to queue as follow-up)"
            }
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        </Show>
      </div>

      <SlashPalette
        open={paletteOpen()}
        onCancel={() => setPaletteOpen(false)}
        onPick={insertCommand}
      />
    </div>
  );
}
