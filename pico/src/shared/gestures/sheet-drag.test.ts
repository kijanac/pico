import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSheetDrag } from "./sheet-drag";

function inlineStyle(): CSSStyleDeclaration {
  const values = new Map<string, { value: string; priority: string }>();
  const propertyName = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const methods = {
    getPropertyValue: (name: string) => values.get(name)?.value ?? "",
    getPropertyPriority: (name: string) => values.get(name)?.priority ?? "",
    setProperty: (name: string, value: string, priority = "") => {
      if (value) values.set(name, { value, priority });
      else values.delete(name);
    },
    removeProperty: (name: string) => {
      const value = values.get(name)?.value ?? "";
      values.delete(name);
      return value;
    },
  };
  return new Proxy(methods, {
    get: (target, key) => key in target ? Reflect.get(target, key) : methods.getPropertyValue(propertyName(String(key))),
    set: (_, key, value) => { methods.setProperty(propertyName(String(key)), String(value)); return true; },
  }) as unknown as CSSStyleDeclaration;
}

function element(): HTMLElement {
  return Object.assign(new EventTarget(), {
    style: inlineStyle(),
    dataset: { state: "open" },
    getAnimations: () => [],
    getBoundingClientRect: () => ({ height: 400 }),
  }) as unknown as HTMLElement;
}

function touch(handle: HTMLElement, type: string, y: number, time: number): void {
  const event = new Event(type);
  Object.defineProperties(event, { touches: { value: [{ clientY: y }] }, timeStamp: { value: time } });
  handle.dispatchEvent(event);
}

describe("sheet drag ownership", () => {
  let handle: HTMLElement;
  let sheet: HTMLElement;
  let shade: HTMLElement;
  let observerCallback: () => void;
  let reducedMotion = false;
  const onDismiss = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onDismiss.mockReset();
    handle = element();
    sheet = element();
    shade = element();
    reducedMotion = false;
    sheet.style.setProperty("transition", "opacity 100ms", "important");
    shade.style.setProperty("opacity", "0.75", "important");
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reducedMotion }) });
    vi.stubGlobal("document", { querySelectorAll: () => [shade] });
    vi.stubGlobal("MutationObserver", class {
      constructor(callback: () => void) { observerCallback = callback; }
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function expectRestored(): void {
    expect(sheet.style.transform).toBe("");
    expect(sheet.style.animation).toBe("");
    expect(sheet.style.willChange).toBe("");
    expect(sheet.style.transition).toBe("opacity 100ms");
    expect(sheet.style.getPropertyPriority("transition")).toBe("important");
    expect(shade.style.opacity).toBe("0.75");
    expect(shade.style.getPropertyPriority("opacity")).toBe("important");
    expect(shade.style.transition).toBe("");
    expect(shade.style.animation).toBe("");
  }

  it("does not change styles when disabled before any interaction", () => {
    const drag = createSheetDrag(handle, { sheet, onDismiss });
    drag.destroy();
    drag.destroy();
    expectRestored();
  });

  it("restores inline styles and detaches a drag when changing placement", () => {
    const drag = createSheetDrag(handle, { sheet, onDismiss });
    touch(handle, "touchstart", 10, 0);
    touch(handle, "touchmove", 100, 20);
    expect(sheet.style.transform).not.toBe("");
    drag.destroy();
    expectRestored();
    touch(handle, "touchstart", 10, 30);
    touch(handle, "touchmove", 200, 50);
    expectRestored();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("cancels a pending dismiss instead of closing the new drawer", () => {
    const drag = createSheetDrag(handle, { sheet, onDismiss });
    touch(handle, "touchstart", 0, 0);
    touch(handle, "touchmove", 200, 20);
    touch(handle, "touchend", 200, 30);
    drag.destroy();
    vi.runAllTimers();
    expectRestored();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("cancels spring-back cleanup so it cannot overwrite a subsequent owner", () => {
    const drag = createSheetDrag(handle, { sheet, onDismiss });
    touch(handle, "touchstart", 0, 0);
    touch(handle, "touchmove", 10, 20);
    touch(handle, "touchend", 10, 30);
    drag.destroy();
    expectRestored();
    shade.style.opacity = "0.42";
    vi.runAllTimers();
    expect(shade.style.opacity).toBe("0.42");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("restores the original inline values after an ordinary spring back", () => {
    const drag = createSheetDrag(handle, { sheet, onDismiss });
    touch(handle, "touchstart", 0, 0);
    touch(handle, "touchmove", 10, 20);
    touch(handle, "touchend", 10, 30);
    vi.runAllTimers();
    expectRestored();
    expect(onDismiss).not.toHaveBeenCalled();
    drag.destroy();
  });

  it("restores a dismissed sheet when it reopens without unmounting", () => {
    reducedMotion = true;
    const drag = createSheetDrag(handle, { sheet, onDismiss });
    touch(handle, "touchstart", 0, 0);
    touch(handle, "touchmove", 200, 20);
    touch(handle, "touchend", 200, 30);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(sheet.style.animation).toBe("none");
    observerCallback();
    expectRestored();
    touch(handle, "touchstart", 0, 40);
    touch(handle, "touchmove", 10, 60);
    expect(sheet.style.transform).not.toBe("");
    drag.destroy();
    expectRestored();
  });
});
