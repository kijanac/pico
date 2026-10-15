import PhotoSwipe from "photoswipe";

export type ImageZoom = { zoom: number; maxZoom: number };
export type ImageViewer = ReturnType<typeof createImageViewer>;
type NativeGesture = Event & { scale: number; clientX: number; clientY: number };
const ZOOM_STEP = Math.SQRT2;
const PAN_STEP = 0.1;

export function createImageViewer(pane: HTMLElement, image: HTMLImageElement, changed: (zoom: ImageZoom) => void, failed: () => void) {
  const viewer = new PhotoSwipe({
    dataSource: [{ src: image.currentSrc || image.src, width: image.naturalWidth, height: image.naturalHeight, alt: image.alt }],
    appendToEl: pane,
    getViewportSizeFn: () => ({ x: pane.clientWidth, y: pane.clientHeight }),
    initialZoomLevel: "fit",
    secondaryZoomLevel: (level) => level.fit * 2,
    maxZoomLevel: (level) => Math.max(level.fit * 4, 2),
    bgOpacity: 0,
    showHideAnimationType: "none",
    zoomAnimationDuration: 0,
    close: false, zoom: false, counter: false, arrowPrev: false, arrowNext: false,
    trapFocus: false, returnFocus: false, escKey: false, arrowKeys: false,
    pinchToClose: false, closeOnVerticalDrag: false, allowPanToNext: false,
    clickToCloseNonZoomable: false, imageClickAction: "zoom", bgClickAction: false, tapAction: false,
    doubleTapAction: "zoom",
  });
  const events = new AbortController();
  let safariStart: number | null = null;
  const syncOffset = () => {
    const rect = pane.getBoundingClientRect();
    viewer.offset.x = rect.left + window.scrollX;
    viewer.offset.y = rect.top + window.scrollY;
  };
  const center = () => viewer.getViewportCenterPoint();
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = pane.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const reset = () => { const slide = viewer.currSlide; if (slide) slide.zoomTo(slide.zoomLevels.fit, center(), 0); };
  const zoomBy = (factor: number) => { const slide = viewer.currSlide; if (slide) slide.zoomTo(slide.currZoomLevel * factor, center(), 0); };

  viewer.on("updateScrollOffset", syncOffset);
  viewer.on("pointerDown", syncOffset);
  viewer.on("keydown", (event) => event.preventDefault());
  viewer.on("loadError", failed);
  viewer.on("zoomPanUpdate", ({ slide }) => changed({ zoom: slide.currZoomLevel / slide.zoomLevels.fit, maxZoom: slide.zoomLevels.max / slide.zoomLevels.fit }));
  viewer.on("wheel", (event) => {
    const input = event.originalEvent;
    const slide = viewer.currSlide;
    if (!slide || (!input.ctrlKey && !input.metaKey)) return;
    event.preventDefault();
    const delta = input.deltaMode === 1 ? input.deltaY * 0.05 : input.deltaY * (input.deltaMode ? 1 : 0.002);
    slide.zoomTo(slide.currZoomLevel * 2 ** -delta, local(input), 0);
  });
  viewer.init();
  viewer.element?.setAttribute("role", "presentation");
  viewer.element?.removeAttribute("tabindex");
  viewer.scrollWrap?.removeAttribute("aria-roledescription");
  viewer.container?.removeAttribute("id");
  syncOffset();

  pane.addEventListener("keydown", (event) => {
    if (event.target !== pane || event.ctrlKey || event.metaKey || event.altKey) return;
    const slide = viewer.currSlide;
    if (!slide) return;
    const key = event.key;
    if (["+", "=", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) event.preventDefault();
    if (key === "+" || key === "=") zoomBy(ZOOM_STEP);
    else if (key === "-") zoomBy(1 / ZOOM_STEP);
    else if (key === "0") reset();
    else if (key === "ArrowLeft" || key === "ArrowRight") slide.panTo(slide.pan.x + pane.clientWidth * PAN_STEP * (key === "ArrowLeft" ? 1 : -1), slide.pan.y);
    else if (key === "ArrowUp" || key === "ArrowDown") slide.panTo(slide.pan.x, slide.pan.y + pane.clientHeight * PAN_STEP * (key === "ArrowUp" ? 1 : -1));
  }, { signal: events.signal });
  pane.addEventListener("gesturestart", (event) => {
    event.preventDefault();
    safariStart = viewer.gestures.isZooming ? null : viewer.currSlide?.currZoomLevel ?? null;
  }, { signal: events.signal, passive: false });
  pane.addEventListener("gesturechange", (event) => {
    event.preventDefault();
    const input = event as NativeGesture;
    if (safariStart !== null && Number.isFinite(input.scale) && input.scale > 0 && !viewer.gestures.isZooming) {
      const point = Number.isFinite(input.clientX) && Number.isFinite(input.clientY) ? local(input) : center();
      viewer.currSlide?.zoomTo(safariStart * input.scale, point, 0);
    }
  }, { signal: events.signal, passive: false });
  pane.addEventListener("gestureend", (event) => { event.preventDefault(); safariStart = null; }, { signal: events.signal, passive: false });
  const resized = new ResizeObserver(() => { viewer.updateSize(); syncOffset(); });
  resized.observe(pane);

  return {
    reset,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    destroy() { resized.disconnect(); events.abort(); viewer.destroy(); },
  };
}
