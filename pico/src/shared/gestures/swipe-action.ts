import { haptics } from "@/shared/mobile/haptics";

const SWIPE_THRESHOLD_PX = 44;
const AXIS_LOCK_PX = 10;
const VERTICAL_CANCEL_PX = 48;

export interface SwipeActionOptions {
  actionWidth: () => number;
  actionCount: () => number;
  isOpen: () => boolean;
  onOpen: () => void;
  onClose: () => void;
}

export function createSwipeActionRow(surface: HTMLElement, options: SwipeActionOptions) {
  let startX = 0;
  let startY = 0;
  let startOpen = false;
  let tracking = false;
  let dragging = false;
  let suppressClick = false;
  let dragOffset: number | null = null;

  const actionsWidth = () => options.actionWidth() * options.actionCount();
  const offset = () => dragOffset ?? (options.isOpen() ? actionsWidth() : 0);

  function render(): void {
    surface.style.transform = `translateX(-${offset()}px)`;
    surface.style.transition = dragOffset === null ? "transform 160ms ease-out" : "none";
    surface.style.touchAction = "pan-y";
  }

  function setDragOffset(next: number | null): void {
    dragOffset = next;
    render();
  }

  function onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;

    startX = touch.clientX;
    startY = touch.clientY;
    startOpen = options.isOpen();
    tracking = true;
    dragging = false;
    suppressClick = false;
    if (!startOpen) options.onClose();
    setDragOffset(startOpen ? actionsWidth() : 0);
  }

  function onTouchMove(event: TouchEvent): void {
    if (!tracking || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (!dragging) {
      if (absDx < AXIS_LOCK_PX && absDy < AXIS_LOCK_PX) return;
      if (absDx <= absDy || absDy > VERTICAL_CANCEL_PX) {
        tracking = false;
        setDragOffset(null);
        if (startOpen) options.onClose();
        return;
      }
      dragging = true;
      suppressClick = true;
    }

    event.preventDefault();
    const next = Math.max(0, Math.min(actionsWidth(), (startOpen ? actionsWidth() : 0) - dx));
    setDragOffset(next);
  }

  function finishSwipe(commitAllowed = true): void {
    if (!tracking && dragOffset === null) return;
    const nextOpen = commitAllowed && offset() > SWIPE_THRESHOLD_PX;
    const buzz = nextOpen && !startOpen;

    tracking = false;
    dragging = false;
    setDragOffset(null);

    if (nextOpen) {
      if (buzz) haptics.medium();
      options.onOpen();
    } else {
      options.onClose();
    }
  }

  function onClick(event: MouseEvent): void {
    if (!suppressClick && !options.isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
    if (options.isOpen()) options.onClose();
  }

  const onTouchEnd = () => finishSwipe();
  const onTouchCancel = () => finishSwipe(false);

  surface.addEventListener("touchstart", onTouchStart, { passive: true });
  surface.addEventListener("touchmove", onTouchMove, { passive: false });
  surface.addEventListener("touchend", onTouchEnd, { passive: true });
  surface.addEventListener("touchcancel", onTouchCancel, { passive: true });
  surface.addEventListener("click", onClick);
  render();

  return {
    render,
    destroy(): void {
      surface.removeEventListener("touchstart", onTouchStart);
      surface.removeEventListener("touchmove", onTouchMove);
      surface.removeEventListener("touchend", onTouchEnd);
      surface.removeEventListener("touchcancel", onTouchCancel);
      surface.removeEventListener("click", onClick);
      surface.style.transform = "";
      surface.style.transition = "";
      surface.style.touchAction = "";
    },
  };
}
