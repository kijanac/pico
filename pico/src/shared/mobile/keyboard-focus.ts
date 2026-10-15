import { Duration, Effect, Fiber } from "effect";
import { focusViewportChanged, holdFocusOpacity, type FocusViewport } from "./focus-opacity";

export const MAX_FOCUS_HIDE_MS = 250;

export function isStandaloneIPhone(userAgent: string, standalone: boolean): boolean {
  return standalone && /iPhone/.test(userAgent);
}

export function installKeyboardFocus(): () => void {
  const visual = window.visualViewport;
  const standalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    || matchMedia("(display-mode: standalone)").matches;
  if (!visual || !isStandaloneIPhone(navigator.userAgent, standalone)) return () => {};

  const readViewport = (): FocusViewport => ({ width: visual.width, height: visual.height, scale: visual.scale });
  let fullViewport = readViewport();
  let opening: FocusViewport | null = null;
  let restoreOpacity: (() => void) | null = null;
  let paint: number | null = null;
  let deadline: Fiber.RuntimeFiber<void, never> | null = null;
  let touchIntent = false;
  const removals: Array<() => void> = [];

  function listen(target: EventTarget, type: string, handler: EventListener, capture = false): void {
    target.addEventListener(type, handler, { capture, passive: true });
    removals.push(() => target.removeEventListener(type, handler, capture));
  }

  function restore(): void {
    opening = null;
    if (paint !== null) cancelAnimationFrame(paint);
    paint = null;
    if (deadline) Effect.runFork(Fiber.interrupt(deadline));
    deadline = null;
    restoreOpacity?.();
    restoreOpacity = null;
  }

  function start(target: EventTarget | null): void {
    restore();
    const current = readViewport();
    if (!touchIntent || document.hidden || current.scale !== 1 || current.height < fullViewport.height) return;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (!target.matches("[data-keyboard-editor]") || target.disabled || target.readOnly || target.inputMode === "none") return;
    opening = current;
    restoreOpacity = holdFocusOpacity(target.style);
    deadline = Effect.runFork(Effect.sleep(Duration.millis(MAX_FOCUS_HIDE_MS)).pipe(Effect.tap(() => {
      deadline = null;
      restore();
    })));
  }

  function resize(): void {
    const current = readViewport();
    if (current.width !== fullViewport.width || current.scale !== fullViewport.scale) {
      restore();
      fullViewport = current;
      return;
    }
    if (current.height > fullViewport.height) fullViewport = current;
    if (!opening || !focusViewportChanged(opening, current) || paint !== null) return;
    paint = requestAnimationFrame(() => {
      paint = null;
      if (opening && focusViewportChanged(opening, readViewport())) restore();
    });
  }

  function pointer(event: Event): void {
    restore();
    touchIntent = event instanceof PointerEvent && event.pointerType === "touch";
    if (event.target === document.activeElement) start(event.target);
  }

  function keyboardInput(): void {
    touchIntent = false;
    restore();
  }

  function suspend(): void {
    touchIntent = false;
    restore();
  }

  listen(document, "pointerdown", pointer, true);
  listen(document, "focus", (event) => start(event.target), true);
  listen(document, "blur", restore, true);
  listen(document, "keydown", keyboardInput, true);
  listen(document, "beforeinput", keyboardInput, true);
  listen(document, "visibilitychange", () => { if (document.hidden) suspend(); });
  listen(window, "pagehide", suspend);
  listen(window, "blur", suspend);
  listen(window, "resize", resize);
  listen(visual, "resize", resize);

  return () => {
    suspend();
    for (const remove of removals) remove();
  };
}
