import { haptics } from "@/shared/mobile/haptics";

const DISMISS_DISTANCE_RATIO = 0.33;
const DISMISS_VELOCITY = 0.5; // px/ms downward
const MIN_DISMISS_DRAG_PX = 24;
const UPWARD_RESISTANCE = 0.18;
const DISMISS_MS = 200;
const SPRING_BACK_MS = 360;
// Overshoot curve so a cancelled drag lands with a small bounce.
const SPRING_BACK_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const DISMISS_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export interface SheetDragOptions {
  sheet: HTMLElement;
  onDismiss: () => void;
}

/**
 * Drag-to-dismiss for bottom sheets: the handle tracks the finger (with
 * rubber-band resistance upward), fades the overlay in step, and on release
 * either springs back or commits the dismissal based on travel + velocity.
 */
export function createSheetDrag(handle: HTMLElement, options: SheetDragOptions) {
  const sheet = options.sheet;

  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let dy = 0;
  let dragging = false;
  let settled = false;

  const overlay = (): HTMLElement | null => {
    const all = document.querySelectorAll<HTMLElement>('[data-slot="sheet-overlay"]');
    return all.length > 0 ? (all[all.length - 1] ?? null) : null;
  };

  const reducedMotion = (): boolean =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function onTouchStart(event: TouchEvent): void {
    if (settled || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;

    dragging = true;
    startY = touch.clientY;
    lastY = touch.clientY;
    lastT = event.timeStamp;
    velocity = 0;
    dy = 0;
    sheet.style.transition = "none";
    sheet.style.willChange = "transform";
    const shade = overlay();
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
    const offset = dy >= 0 ? dy : dy * UPWARD_RESISTANCE;
    sheet.style.transform = `translate3d(0, ${offset}px, 0)`;

    const shade = overlay();
    if (shade) {
      const progress = Math.min(1, Math.max(0, dy) / Math.max(1, sheet.getBoundingClientRect().height));
      shade.style.opacity = String(1 - progress * 0.9);
    }
  }

  function onTouchEnd(): void {
    if (!dragging) return;
    dragging = false;

    const height = sheet.getBoundingClientRect().height;
    const commit =
      dy > MIN_DISMISS_DRAG_PX &&
      (dy > height * DISMISS_DISTANCE_RATIO || velocity > DISMISS_VELOCITY);

    if (commit) dismiss(height);
    else springBack();
  }

  function dismiss(height: number): void {
    settled = true;
    haptics.light();
    const shade = overlay();
    const finish = () => {
      // Keep the dragged position through unmount: the inline animation
      // override stops the data-closed slide/fade from replaying on top.
      sheet.style.animation = "none";
      if (shade) shade.style.animation = "none";
      options.onDismiss();
    };

    if (reducedMotion()) {
      finish();
      return;
    }

    sheet.style.transition = `transform ${DISMISS_MS}ms ${DISMISS_EASE}`;
    sheet.style.transform = `translate3d(0, ${height + 60}px, 0)`;
    if (shade) {
      shade.style.transition = `opacity ${DISMISS_MS}ms ${DISMISS_EASE}`;
      shade.style.opacity = "0";
    }
    setTimeout(finish, DISMISS_MS + 10);
  }

  function springBack(): void {
    const shade = overlay();
    const duration = reducedMotion() ? 0 : SPRING_BACK_MS;
    sheet.style.transition = `transform ${duration}ms ${SPRING_BACK_EASE}`;
    sheet.style.transform = "translate3d(0, 0, 0)";
    if (shade) {
      shade.style.transition = `opacity ${duration}ms ease-out`;
      shade.style.opacity = "";
    }
    setTimeout(() => {
      sheet.style.transition = "";
      sheet.style.transform = "";
      sheet.style.willChange = "";
      if (shade) shade.style.transition = "";
    }, duration + 10);
  }

  handle.addEventListener("touchstart", onTouchStart, { passive: true });
  handle.addEventListener("touchmove", onTouchMove, { passive: true });
  handle.addEventListener("touchend", onTouchEnd, { passive: true });
  handle.addEventListener("touchcancel", onTouchEnd, { passive: true });

  return {
    destroy() {
      handle.removeEventListener("touchstart", onTouchStart);
      handle.removeEventListener("touchmove", onTouchMove);
      handle.removeEventListener("touchend", onTouchEnd);
      handle.removeEventListener("touchcancel", onTouchEnd);
    },
  };
}
