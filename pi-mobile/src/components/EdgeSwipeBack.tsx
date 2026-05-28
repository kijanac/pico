import { useNavigate } from "@solidjs/router";
import { onCleanup, onMount, type JSX } from "solid-js";
import { haptic } from "~/lib/haptics";

interface Props {
  /** Route to navigate to after the gesture completes. */
  href: string;
  /** Non-interactive previous-screen preview revealed during the gesture. */
  preview?: JSX.Element;
  children: JSX.Element;
}

const EDGE_WIDTH = 32;
const LOCK_DISTANCE = 10;
const MIN_COMPLETE_DISTANCE = 86;
const MAX_COMPLETE_DISTANCE = 120;
const COMPLETE_FRACTION = 0.28;
const COMPLETE_VELOCITY = 0.45; // px/ms
const VELOCITY_MIN_DISTANCE = 32;
const MAX_VERTICAL_DRIFT = 56;
const COMPLETE_MS = 170;
const PREVIEW_PARALLAX_PX = 24;

/**
 * iOS-style interactive edge-swipe back.
 *
 * Best-practice constraints for a webview chat UI:
 * - only begins from the left edge, so scrollable code blocks/chat content keep
 *   their normal horizontal gestures;
 * - locks to horizontal motion before calling preventDefault(), so vertical
 *   scroll remains native;
 * - animates with direct DOM writes instead of Solid state on every touchmove;
 * - gives one threshold haptic, then either completes or snaps back.
 */
export default function EdgeSwipeBack(props: Props): JSX.Element {
  const navigate = useNavigate();
  let page!: HTMLDivElement;
  let preview!: HTMLDivElement;
  let shade!: HTMLDivElement;

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let startedAt = 0;
  let tracking = false;
  let dragging = false;
  let thresholdBuzzed = false;
  let navTimer: number | undefined;

  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const completeDistance = () =>
    Math.min(
      MAX_COMPLETE_DISTANCE,
      Math.max(MIN_COMPLETE_DISTANCE, page.clientWidth * COMPLETE_FRACTION),
    );

  const setProgress = (dx: number) => {
    const width = Math.max(page.clientWidth, 1);
    const clamped = Math.min(dx, width);
    const progress = Math.min(clamped / completeDistance(), 1);

    page.style.transform = `translate3d(${clamped}px, 0, 0)`;
    preview.style.transform = `translate3d(${(progress - 1) * PREVIEW_PARALLAX_PX}px, 0, 0) scale(${0.985 + progress * 0.015})`;
    preview.style.opacity = String(0.74 + progress * 0.26);
    shade.style.opacity = String(0.18 * (1 - progress));

    if (!thresholdBuzzed && progress >= 1) {
      thresholdBuzzed = true;
      haptic.medium();
    } else if (thresholdBuzzed && progress < 0.72) {
      thresholdBuzzed = false;
    }
  };

  const reset = () => {
    tracking = false;
    dragging = false;
    thresholdBuzzed = false;
    page.classList.remove("edge-swipe-dragging", "edge-swipe-settling");
    preview.classList.remove("edge-swipe-dragging", "edge-swipe-settling");
    page.style.transform = "";
    preview.style.transform = "";
    preview.style.opacity = "";
    shade.style.opacity = "";
  };

  const isIgnoredTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"], [data-edge-swipe-ignore="true"]',
      ),
    );
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1 || isIgnoredTarget(event.target)) return;

    const touch = event.touches[0];
    if (!touch || touch.clientX > EDGE_WIDTH) return;

    startX = touch.clientX;
    startY = touch.clientY;
    lastX = startX;
    startedAt = performance.now();
    tracking = true;
    dragging = false;
    thresholdBuzzed = false;
    page.classList.remove("edge-swipe-settling");
    preview.classList.remove("edge-swipe-settling");
  };

  const onTouchMove = (event: TouchEvent) => {
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
      page.classList.add("edge-swipe-dragging");
      preview.classList.add("edge-swipe-dragging");
    }

    event.preventDefault();

    setProgress(dx);
  };

  const finish = (commitAllowed = true) => {
    if (!tracking) return;

    const dx = Math.max(0, lastX - startX);
    const dt = Math.max(performance.now() - startedAt, 1);
    const velocity = dx / dt;
    const shouldComplete =
      commitAllowed &&
      dragging &&
      (dx >= completeDistance() ||
        (dx >= VELOCITY_MIN_DISTANCE && velocity >= COMPLETE_VELOCITY));

    tracking = false;

    if (!dragging) {
      reset();
      return;
    }

    page.classList.remove("edge-swipe-dragging");
    preview.classList.remove("edge-swipe-dragging");
    page.classList.add("edge-swipe-settling");
    preview.classList.add("edge-swipe-settling");

    if (shouldComplete) {
      haptic.light();
      if (prefersReducedMotion()) {
        page.style.transform = "";
        preview.style.transform = "";
      } else {
        page.style.transform = "translate3d(100%, 0, 0)";
        preview.style.transform = "translate3d(0, 0, 0) scale(1)";
      }
      preview.style.opacity = "1";
      shade.style.opacity = "0";
      navTimer = window.setTimeout(
        () => navigate(props.href),
        prefersReducedMotion() ? 0 : COMPLETE_MS,
      );
    } else {
      page.style.transform = "";
      preview.style.transform = "";
      preview.style.opacity = "";
      shade.style.opacity = "";
      window.setTimeout(reset, COMPLETE_MS);
    }
  };

  const onTouchEnd = () => finish();
  const onTouchCancel = () => finish(false);

  onMount(() => {
    page.addEventListener("touchstart", onTouchStart, { passive: true });
    page.addEventListener("touchmove", onTouchMove, { passive: false });
    page.addEventListener("touchend", onTouchEnd, { passive: true });
    page.addEventListener("touchcancel", onTouchCancel, { passive: true });
  });

  onCleanup(() => {
    page.removeEventListener("touchstart", onTouchStart);
    page.removeEventListener("touchmove", onTouchMove);
    page.removeEventListener("touchend", onTouchEnd);
    page.removeEventListener("touchcancel", onTouchCancel);
    if (navTimer !== undefined) window.clearTimeout(navTimer);
  });

  return (
    <div class="edge-swipe-root min-h-dvh bg-[color:var(--color-bg)]">
      <div
        ref={preview}
        aria-hidden="true"
        class="edge-swipe-preview pointer-events-none fixed inset-0 z-0"
      >
        {props.preview}
        <div
          ref={shade}
          class="edge-swipe-shade pointer-events-none fixed inset-0 opacity-100"
        />
      </div>
      <div ref={page} class="edge-swipe-page relative z-10 min-h-dvh bg-[color:var(--color-bg)]">
        {props.children}
      </div>
    </div>
  );
}
