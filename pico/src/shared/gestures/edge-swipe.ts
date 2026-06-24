import { haptics } from "@/shared/mobile/haptics";

const EDGE_WIDTH = 32;
const LOCK_DISTANCE = 10;
const MIN_COMPLETE_DISTANCE = 86;
const MAX_COMPLETE_DISTANCE = 120;
const COMPLETE_FRACTION = 0.28;
const COMPLETE_VELOCITY = 0.45;
const VELOCITY_MIN_DISTANCE = 32;
const MAX_VERTICAL_DRIFT = 56;
const COMPLETE_MS = 170;
const PREVIEW_PARALLAX_PX = 24;

export interface EdgeSwipeOptions {
  page: HTMLElement;
  preview: HTMLElement;
  shade: HTMLElement;
  onComplete: () => void;
}

export function createEdgeSwipeBack(options: EdgeSwipeOptions) {
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let startedAt = 0;
  let tracking = false;
  let dragging = false;
  let thresholdBuzzed = false;
  let navTimer: number | undefined;
  let settleTimer: number | undefined;

  const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const completeDistance = () =>
    Math.min(
      MAX_COMPLETE_DISTANCE,
      Math.max(MIN_COMPLETE_DISTANCE, options.page.clientWidth * COMPLETE_FRACTION),
    );

  function setProgress(dx: number): void {
    const width = Math.max(options.page.clientWidth, 1);
    const clamped = Math.min(dx, width);
    const progress = Math.min(clamped / completeDistance(), 1);

    options.page.style.transform = `translate3d(${clamped}px, 0, 0)`;
    options.preview.style.transform = `translate3d(${(progress - 1) * PREVIEW_PARALLAX_PX}px, 0, 0) scale(${0.985 + progress * 0.015})`;
    options.preview.style.opacity = String(0.74 + progress * 0.26);
    options.shade.style.opacity = String(0.18 * (1 - progress));

    if (!thresholdBuzzed && progress >= 1) {
      thresholdBuzzed = true;
      haptics.medium();
    } else if (thresholdBuzzed && progress < 0.72) {
      thresholdBuzzed = false;
    }
  }

  function reset(): void {
    if (settleTimer !== undefined) {
      window.clearTimeout(settleTimer);
      settleTimer = undefined;
    }
    tracking = false;
    dragging = false;
    thresholdBuzzed = false;
    options.page.classList.remove("edge-swipe-dragging", "edge-swipe-settling");
    options.preview.classList.remove("edge-swipe-dragging", "edge-swipe-settling");
    options.page.style.transform = "";
    options.preview.style.transform = "";
    options.preview.style.opacity = "";
    options.shade.style.opacity = "";
  }

  function isIgnoredTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest('input, textarea, select, [contenteditable="true"], [data-edge-swipe-ignore="true"]'),
    );
  }

  function onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1 || isIgnoredTarget(event.target)) return;

    const touch = event.touches[0];
    if (!touch || touch.clientX > EDGE_WIDTH) return;

    startX = touch.clientX;
    startY = touch.clientY;
    lastX = startX;
    if (navTimer !== undefined) {
      window.clearTimeout(navTimer);
      navTimer = undefined;
    }
    if (settleTimer !== undefined) {
      window.clearTimeout(settleTimer);
      settleTimer = undefined;
    }

    startedAt = performance.now();
    tracking = true;
    dragging = false;
    thresholdBuzzed = false;
    options.page.classList.remove("edge-swipe-settling");
    options.preview.classList.remove("edge-swipe-settling");
  }

  function onTouchMove(event: TouchEvent): void {
    if (!tracking || event.touches.length !== 1) return;

    const touch = event.touches[0];
    if (!touch) return;

    const dx = Math.max(0, touch.clientX - startX);
    const dy = touch.clientY - startY;
    const absDy = Math.abs(dy);
    lastX = touch.clientX;

    if (!dragging) {
      if (dx < LOCK_DISTANCE && absDy < LOCK_DISTANCE) return;
      if (dx <= absDy * 1.2 || absDy > MAX_VERTICAL_DRIFT) {
        tracking = false;
        return;
      }
      dragging = true;
      options.page.classList.add("edge-swipe-dragging");
      options.preview.classList.add("edge-swipe-dragging");
    }

    event.preventDefault();
    setProgress(dx);
  }

  function finish(commitAllowed = true): void {
    if (!tracking) return;

    const dx = Math.max(0, lastX - startX);
    const dt = Math.max(performance.now() - startedAt, 1);
    const velocity = dx / dt;
    const shouldComplete =
      commitAllowed &&
      dragging &&
      (dx >= completeDistance() || (dx >= VELOCITY_MIN_DISTANCE && velocity >= COMPLETE_VELOCITY));

    tracking = false;

    if (!dragging) {
      reset();
      return;
    }

    options.page.classList.remove("edge-swipe-dragging");
    options.preview.classList.remove("edge-swipe-dragging");
    options.page.classList.add("edge-swipe-settling");
    options.preview.classList.add("edge-swipe-settling");

    if (shouldComplete) {
      haptics.light();
      if (prefersReducedMotion()) {
        options.page.style.transform = "";
        options.preview.style.transform = "";
      } else {
        options.page.style.transform = "translate3d(100%, 0, 0)";
        options.preview.style.transform = "translate3d(0, 0, 0) scale(1)";
      }
      options.preview.style.opacity = "1";
      options.shade.style.opacity = "0";
      navTimer = window.setTimeout(options.onComplete, prefersReducedMotion() ? 0 : COMPLETE_MS);
    } else {
      options.page.style.transform = "";
      options.preview.style.transform = "";
      options.preview.style.opacity = "";
      options.shade.style.opacity = "";
      settleTimer = window.setTimeout(reset, COMPLETE_MS);
    }
  }

  const onTouchEnd = () => finish();
  const onTouchCancel = () => finish(false);

  options.page.addEventListener("touchstart", onTouchStart, { passive: true });
  options.page.addEventListener("touchmove", onTouchMove, { passive: false });
  options.page.addEventListener("touchend", onTouchEnd, { passive: true });
  options.page.addEventListener("touchcancel", onTouchCancel, { passive: true });

  return {
    destroy(): void {
      options.page.removeEventListener("touchstart", onTouchStart);
      options.page.removeEventListener("touchmove", onTouchMove);
      options.page.removeEventListener("touchend", onTouchEnd);
      options.page.removeEventListener("touchcancel", onTouchCancel);
      if (navTimer !== undefined) window.clearTimeout(navTimer);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      reset();
    },
  };
}
