import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createImageViewer } from "./image-viewer";

const library = vi.hoisted(() => ({ instance: null as any }));
vi.mock("photoswipe", () => ({
  default: class {
    options: any;
    offset = { x: 0, y: 0 };
    gestures = { isZooming: false };
    element = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    scrollWrap = { removeAttribute: vi.fn() };
    container = { removeAttribute: vi.fn() };
    listeners = new Map<string, (event: any) => void>();
    currSlide = { currZoomLevel: 0.5, zoomLevels: { fit: 0.5, max: 2 }, pan: { x: 0, y: 0 }, zoomTo: vi.fn(), panTo: vi.fn(), toggleZoom: vi.fn() };
    init = vi.fn();
    destroy = vi.fn();
    updateSize = vi.fn();
    getViewportCenterPoint = () => ({ x: 150, y: 200 });
    on(name: string, callback: (event: any) => void) { this.listeners.set(name, callback); }
    constructor(options: unknown) { this.options = options; library.instance = this; }
  },
}));

class Pane extends EventTarget {
  clientWidth = 300;
  clientHeight = 400;
  getBoundingClientRect = () => ({ left: 20, top: 100 });
}

function event(type: string, properties: Record<string, unknown> = {}) {
  return Object.assign(new Event(type, { cancelable: true }), properties);
}

let pane: Pane;
let resize: () => void;
let disconnect: ReturnType<typeof vi.fn>;
let controls: ReturnType<typeof createImageViewer>;
const changed = vi.fn();
const failed = vi.fn();
const fire = (name: string, detail: unknown) => library.instance.listeners.get(name)?.(detail);

beforeEach(() => {
  vi.stubGlobal("window", { scrollX: 5, scrollY: 7 });
  disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  pane = new Pane();
  controls = createImageViewer(pane as unknown as HTMLElement, { currentSrc: "/image.png", naturalWidth: 600, naturalHeight: 800, alt: "screenshot" } as HTMLImageElement, changed, failed);
});
afterEach(() => { controls.destroy(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("embedded image viewer policy", () => {
  it("uses the library engine inside the existing sheet without a second toolbar, focus trap, or dismiss gesture", () => {
    expect(library.instance.options).toMatchObject({ appendToEl: pane, initialZoomLevel: "fit", doubleTapAction: "zoom", close: false, zoom: false, trapFocus: false, returnFocus: false, escKey: false, pinchToClose: false, closeOnVerticalDrag: false });
    expect(library.instance.element.setAttribute).toHaveBeenCalledWith("role", "presentation");
    expect(library.instance.options.dataSource[0]).toEqual({ src: "/image.png", width: 600, height: 800, alt: "screenshot" });
  });

  it("keeps both four-times-fit and two-times-native available for screenshots", () => {
    expect(library.instance.options.secondaryZoomLevel({ fit: 0.5 })).toBe(1);
    expect(library.instance.options.maxZoomLevel({ fit: 0.1 })).toBe(2);
    expect(library.instance.options.maxZoomLevel({ fit: 1 })).toBe(4);
  });

  it("maps page pointer offsets to the embedded pane, including after a resize", () => {
    expect(library.instance.offset).toEqual({ x: 25, y: 107 });
    pane.getBoundingClientRect = () => ({ left: 40, top: 200 });
    resize();
    expect(library.instance.updateSize).toHaveBeenCalledOnce();
    expect(library.instance.offset).toEqual({ x: 45, y: 207 });
  });

  it("leaves ordinary wheel panning to the engine", () => {
    const preventDefault = vi.fn();
    fire("wheel", { originalEvent: { deltaY: 100, deltaMode: 0 }, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(library.instance.currSlide.zoomTo).not.toHaveBeenCalled();
  });

  it.each(["ctrlKey", "metaKey"])("maps %s wheel focal points without changing the library wheel response", (modifier) => {
    const preventDefault = vi.fn();
    fire("wheel", { originalEvent: { [modifier]: true, clientX: 100, clientY: 250, deltaY: -500, deltaMode: 0 }, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(library.instance.currSlide.zoomTo).toHaveBeenCalledWith(1, { x: 80, y: 150 }, 0);
  });

  it("scopes keyboard shortcuts to the pane and leaves browser shortcuts and Escape alone", () => {
    pane.dispatchEvent(event("keydown", { key: "+" }));
    expect(library.instance.currSlide.zoomTo).toHaveBeenLastCalledWith(0.5 * Math.SQRT2, { x: 150, y: 200 }, 0);
    pane.dispatchEvent(event("keydown", { key: "0" }));
    expect(library.instance.currSlide.zoomTo).toHaveBeenLastCalledWith(0.5, { x: 150, y: 200 }, 0);
    const browser = event("keydown", { key: "+", ctrlKey: true });
    const escape = event("keydown", { key: "Escape" });
    pane.dispatchEvent(browser); pane.dispatchEvent(escape);
    expect(browser.defaultPrevented).toBe(false);
    expect(escape.defaultPrevented).toBe(false);
    expect(library.instance.currSlide.zoomTo).toHaveBeenCalledTimes(2);
    const preventDefault = vi.fn();
    fire("keydown", { preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("delegates native Safari scale events but never double-applies a touch pinch", () => {
    pane.dispatchEvent(event("gesturestart", { scale: 1 }));
    pane.dispatchEvent(event("gesturechange", { scale: 2 }));
    expect(library.instance.currSlide.zoomTo).toHaveBeenCalledWith(1, { x: 150, y: 200 }, 0);
    library.instance.gestures.isZooming = true;
    pane.dispatchEvent(event("gesturechange", { scale: 3 }));
    expect(library.instance.currSlide.zoomTo).toHaveBeenCalledOnce();
    pane.dispatchEvent(event("gestureend"));
    library.instance.gestures.isZooming = false;
    pane.dispatchEvent(event("gesturechange", { scale: 3 }));
    expect(library.instance.currSlide.zoomTo).toHaveBeenCalledOnce();
  });

  it("exposes relative zoom status and forwards image load failure to the existing retry state", () => {
    fire("zoomPanUpdate", { slide: library.instance.currSlide });
    expect(changed).toHaveBeenCalledWith({ zoom: 1, maxZoom: 4 });
    fire("loadError", {});
    expect(failed).toHaveBeenCalledOnce();
  });

  it("removes adapter listeners and disposes the observer and library on departure", () => {
    controls.destroy();
    pane.dispatchEvent(event("keydown", { key: "+" }));
    pane.dispatchEvent(event("dblclick", { clientX: 100, clientY: 200 }));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(library.instance.destroy).toHaveBeenCalledOnce();
    expect(library.instance.currSlide.zoomTo).not.toHaveBeenCalled();
    expect(library.instance.currSlide.toggleZoom).not.toHaveBeenCalled();
  });
});
