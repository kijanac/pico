import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installKeyboardFocus, isStandaloneIPhone, MAX_FOCUS_HIDE_MS } from "./keyboard-focus";

class Editor extends EventTarget {
  disabled = false;
  readOnly = false;
  inputMode = "text";
  marked = true;
  opacity = "";
  priority = "";
  style = {
    getPropertyValue: () => this.opacity,
    getPropertyPriority: () => this.priority,
    setProperty: (_name: string, value: string, priority = "") => { this.opacity = value; this.priority = priority; },
    removeProperty: () => { const previous = this.opacity; this.opacity = ""; this.priority = ""; return previous; },
  };
  matches() { return this.marked; }
}

class TouchEvent extends Event {
  pointerType: string;
  constructor(type: string, pointerType = "touch") { super(type); this.pointerType = pointerType; }
}

describe("iPhone home-screen focus scope", () => {
  it.each([
    ["iPhone Safari", true, true],
    ["iPhone Safari", false, false],
    ["Android Chrome", true, false],
    ["Macintosh Safari", true, false],
    ["iPad Safari", true, false],
  ])("%s standalone=%s guarded=%s", (ua, standalone, guarded) => {
    expect(isStandaloneIPhone(ua, standalone)).toBe(guarded);
  });
});

describe("automatic keyboard focus ownership", () => {
  let visual: EventTarget & { width: number; height: number; scale: number };
  let documentTarget: EventTarget & { hidden: boolean; activeElement: Editor | null };
  let windowTarget: EventTarget;
  let editor: Editor;
  let paints: Map<number, FrameRequestCallback>;
  let release: () => void;

  function fire(type: string, target = editor, pointerType = "touch"): Event {
    const event = type === "pointerdown" ? new TouchEvent(type, pointerType) : new Event(type);
    Object.defineProperty(event, "target", { value: target });
    documentTarget.dispatchEvent(event);
    return event;
  }

  function focus(target = editor): void {
    fire("pointerdown", target);
    documentTarget.activeElement = target;
    fire("focus", target);
  }

  function resize(patch: Partial<{ width: number; height: number; scale: number }>): void {
    Object.assign(visual, patch);
    visual.dispatchEvent(new Event("resize"));
  }

  function paint(): void {
    const callbacks = [...paints.values()];
    paints.clear();
    for (const callback of callbacks) callback(0);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    visual = Object.assign(new EventTarget(), { width: 402, height: 812, scale: 1 });
    documentTarget = Object.assign(new EventTarget(), { hidden: false, activeElement: null });
    windowTarget = Object.assign(new EventTarget(), { visualViewport: visual });
    editor = new Editor();
    paints = new Map();
    let nextPaint = 0;
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("navigator", { userAgent: "iPhone Safari", standalone: true });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("HTMLInputElement", Editor);
    vi.stubGlobal("HTMLTextAreaElement", Editor);
    vi.stubGlobal("PointerEvent", TouchEvent);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { paints.set(++nextPaint, callback); return nextPaint; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => paints.delete(id));
    release = installKeyboardFocus();
  });

  afterEach(() => {
    release();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("automatically holds touch focus through unchanged paints, without cancelling the tap", () => {
    const tap = fire("pointerdown");
    fire("focus");
    paint();
    paint();
    expect(editor.opacity).toBe("0");
    expect(tap.defaultPrevented).toBe(false);
  });

  it("restores after the measured shrink's layout frame", () => {
    focus();
    resize({ height: 471 });
    expect(editor.opacity).toBe("0");
    paint();
    expect(editor.opacity).toBe("");
    expect(paints.size).toBe(0);
  });

  it("restores when no resize arrives within the visibility budget", async () => {
    focus();
    await vi.advanceTimersByTimeAsync(MAX_FOCUS_HIDE_MS - 1);
    expect(editor.opacity).toBe("0");
    await vi.advanceTimersByTimeAsync(1);
    expect(editor.opacity).toBe("");
  });

  it("leaves keyboard navigation and non-touch focus unchanged", () => {
    fire("keydown");
    fire("focus");
    expect(editor.opacity).toBe("");
    fire("pointerdown", editor, "mouse");
    fire("focus");
    expect(editor.opacity).toBe("");
  });

  it("does not hide another field when the keyboard is already open", () => {
    resize({ height: 471 });
    focus();
    expect(editor.opacity).toBe("");
  });

  it("handles dismissal and retapping the still-focused editor", () => {
    focus();
    resize({ height: 471 });
    paint();
    resize({ height: 812 });
    fire("pointerdown");
    expect(editor.opacity).toBe("0");
    resize({ height: 471 });
    paint();
    expect(editor.opacity).toBe("");
  });

  it.each(["keydown", "beforeinput", "blur", "pointerdown"])("%s restores before further interaction", (type) => {
    focus();
    documentTarget.activeElement = null;
    fire(type);
    expect(editor.opacity).toBe("");
  });

  it.each(["pagehide", "blur"])("window %s releases the field", (type) => {
    focus();
    windowTarget.dispatchEvent(new Event(type));
    expect(editor.opacity).toBe("");
  });

  it("restores on backgrounding and does not guard hidden focus", () => {
    focus();
    documentTarget.hidden = true;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(editor.opacity).toBe("");
    focus();
    expect(editor.opacity).toBe("");
  });

  it("restores immediately on rotation or zoom", () => {
    focus();
    resize({ width: 812, height: 402 });
    expect(editor.opacity).toBe("");
    focus();
    resize({ scale: 2 });
    expect(editor.opacity).toBe("");
  });

  it("releases the outgoing owner without overwriting later styles", () => {
    focus();
    editor.style.setProperty("opacity", "0.6");
    const next = new Editor();
    focus(next);
    expect(editor.opacity).toBe("0.6");
    expect(next.opacity).toBe("0");
    release();
    expect(next.opacity).toBe("");
  });

  it("cleanup cancels pending restoration and removes all active listeners", () => {
    focus();
    resize({ height: 471 });
    expect(paints.size).toBe(1);
    release();
    expect(editor.opacity).toBe("");
    expect(paints.size).toBe(0);
    resize({ height: 812 });
    focus();
    expect(editor.opacity).toBe("");
  });

  it.each(["unmarked", "readonly", "disabled", "no-input-mode"])("does not guard %s fields", (kind) => {
    if (kind === "unmarked") editor.marked = false;
    if (kind === "readonly") editor.readOnly = true;
    if (kind === "disabled") editor.disabled = true;
    if (kind === "no-input-mode") editor.inputMode = "none";
    focus();
    expect(editor.opacity).toBe("");
  });
});
