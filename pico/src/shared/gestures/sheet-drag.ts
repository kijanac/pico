const DISMISS_DISTANCE_RATIO = 0.33;
const DISMISS_VELOCITY_PX_PER_MS = 0.5;
const STALE_VELOCITY_MS = 100;
const MIN_DISMISS_DRAG_PX = 24;
const UPWARD_RESISTANCE = 0.18;
const DISMISS_MS = 200;
const SPRING_BACK_MS = 250;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export interface SheetDragOptions {
  sheet: HTMLElement;
  onDismiss: () => void;
}

function preserveInlineStyles(elements: (HTMLElement | null)[]): () => void {
  const properties = ["transform", "transition", "animation", "opacity", "will-change"];
  const snapshots = elements.filter((element): element is HTMLElement => element !== null).map((element) => ({
    element,
    styles: properties.map((property) => ({ property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) })),
  }));
  return () => {
    for (const { element, styles } of snapshots) {
      for (const { property, value, priority } of styles) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    }
  };
}

export function createSheetDrag(handle: HTMLElement, options: SheetDragOptions) {
  const sheet = options.sheet;

  let startY = 0;
  let base = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let dy = 0;
  let height = 0;
  let shade: HTMLElement | null = null;
  let dragging = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let restoreInlineStyles: (() => void) | undefined;

  const overlay = (): HTMLElement | null =>
    [...document.querySelectorAll<HTMLElement>('[data-slot="sheet-overlay"]')].at(-1) ?? null;

  const reducedMotion = (): boolean =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function restoreStyles(): void {
    restoreInlineStyles?.();
    restoreInlineStyles = undefined;
  }

  function onTouchStart(event: TouchEvent): void {
    if (settled || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;

    clearTimeout(timer);
    const opening = sheet.getAnimations();
    base = opening.length > 0 ? new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42 : 0;
    for (const animation of opening) animation.cancel();
    dragging = true;
    startY = touch.clientY;
    lastY = touch.clientY;
    lastT = event.timeStamp;
    velocity = 0;
    dy = 0;
    height = sheet.getBoundingClientRect().height;
    shade = overlay();
    restoreInlineStyles ??= preserveInlineStyles([sheet, shade]);
    sheet.style.transition = "none";
    sheet.style.willChange = "transform";
    if (shade) shade.style.transition = "none";
  }

  function onTouchMove(event: TouchEvent): void {
    if (!dragging || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;

    const dt = event.timeStamp - lastT;
    if (dt > 0) velocity = (touch.clientY - lastY) / dt;
    lastY = touch.clientY;
    lastT = event.timeStamp;

    dy = touch.clientY - startY;
    const position = base + dy;
    const offset = position >= 0 ? position : position * UPWARD_RESISTANCE;
    sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
    if (shade) shade.style.opacity = String(1 - Math.min(1, Math.max(0, position) / Math.max(1, height)) * 0.9);
  }

  function onTouchEnd(event: TouchEvent): void {
    if (!dragging) return;
    dragging = false;

    const releaseVelocity = event.timeStamp - lastT < STALE_VELOCITY_MS ? velocity : 0;
    const commit =
      dy > MIN_DISMISS_DRAG_PX &&
      (base + dy > height * DISMISS_DISTANCE_RATIO || releaseVelocity > DISMISS_VELOCITY_PX_PER_MS);

    if (commit) dismiss();
    else springBack();
  }

  function onTouchCancel(): void {
    if (!dragging) return;
    dragging = false;
    springBack();
  }

  function dismiss(): void {
    settled = true;
    const finish = () => {
      sheet.style.animation = "none";
      if (shade) shade.style.animation = "none";
      options.onDismiss();
    };

    if (reducedMotion()) {
      finish();
      return;
    }

    sheet.style.transition = `transform ${DISMISS_MS}ms ${EASE}`;
    sheet.style.transform = `translate3d(0, ${height + 60}px, 0)`;
    if (shade) {
      shade.style.transition = `opacity ${DISMISS_MS}ms ${EASE}`;
      shade.style.opacity = "0";
    }
    timer = setTimeout(finish, DISMISS_MS + 10);
  }

  function springBack(): void {
    const duration = reducedMotion() ? 0 : SPRING_BACK_MS;
    sheet.style.transition = `transform ${duration}ms ${EASE}`;
    sheet.style.transform = "translate3d(0, 0, 0)";
    if (shade) {
      shade.style.transition = `opacity ${duration}ms ${EASE}`;
      shade.style.opacity = "";
    }
    timer = setTimeout(restoreStyles, duration + 10);
  }

  const reopen = new MutationObserver(() => {
    if (!settled || sheet.dataset.state !== "open") return;
    settled = false;
    clearTimeout(timer);
    restoreStyles();
  });
  reopen.observe(sheet, { attributes: true, attributeFilter: ["data-state"] });

  handle.addEventListener("touchstart", onTouchStart, { passive: true });
  handle.addEventListener("touchmove", onTouchMove, { passive: true });
  handle.addEventListener("touchend", onTouchEnd, { passive: true });
  handle.addEventListener("touchcancel", onTouchCancel, { passive: true });

  return {
    destroy() {
      clearTimeout(timer);
      reopen.disconnect();
      restoreStyles();
      handle.removeEventListener("touchstart", onTouchStart);
      handle.removeEventListener("touchmove", onTouchMove);
      handle.removeEventListener("touchend", onTouchEnd);
      handle.removeEventListener("touchcancel", onTouchCancel);
    },
  };
}
