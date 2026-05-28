import { useNavigate } from "@solidjs/router";
import { onCleanup, onMount, type JSX } from "solid-js";
import { haptic } from "~/lib/haptics";

interface Props {
  /** Route to navigate to after the gesture completes. */
  href: string;
  children: JSX.Element;
}

const EDGE_WIDTH = 32;
const LOCK_DISTANCE = 10;
const COMPLETE_DISTANCE = 86;
const COMPLETE_VELOCITY = 0.45; // px/ms
const MAX_VERTICAL_DRIFT = 56;
const COMPLETE_MS = 170;

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

  const reset = () => {
    tracking = false;
    dragging = false;
    thresholdBuzzed = false;
    page.classList.remove("edge-swipe-dragging", "edge-swipe-settling");
    page.style.transform = "";
    shade.style.opacity = "0";
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
    }

    event.preventDefault();

    const width = Math.max(page.clientWidth, 1);
    const clamped = Math.min(dx, width);
    const progress = Math.min(clamped / COMPLETE_DISTANCE, 1);

    page.style.transform = `translate3d(${clamped}px, 0, 0)`;
    shade.style.opacity = String(0.1 * Math.min(clamped / COMPLETE_DISTANCE, 1));

    if (!thresholdBuzzed && progress >= 1) {
      thresholdBuzzed = true;
      haptic.medium();
    } else if (thresholdBuzzed && progress < 0.72) {
      thresholdBuzzed = false;
    }
  };

  const finish = () => {
    if (!tracking) return;

    const dx = Math.max(0, lastX - startX);
    const dt = Math.max(performance.now() - startedAt, 1);
    const velocity = dx / dt;
    const shouldComplete =
      dragging && (dx >= COMPLETE_DISTANCE || velocity >= COMPLETE_VELOCITY);

    tracking = false;

    if (!dragging) {
      reset();
      return;
    }

    page.classList.remove("edge-swipe-dragging");
    page.classList.add("edge-swipe-settling");

    if (shouldComplete) {
      haptic.light();
      page.style.transform = prefersReducedMotion()
        ? ""
        : "translate3d(100%, 0, 0)";
      shade.style.opacity = "0";
      navTimer = window.setTimeout(
        () => navigate(props.href),
        prefersReducedMotion() ? 0 : COMPLETE_MS,
      );
    } else {
      page.style.transform = "";
      shade.style.opacity = "0";
      window.setTimeout(reset, COMPLETE_MS);
    }
  };

  onMount(() => {
    page.addEventListener("touchstart", onTouchStart, { passive: true });
    page.addEventListener("touchmove", onTouchMove, { passive: false });
    page.addEventListener("touchend", finish, { passive: true });
    page.addEventListener("touchcancel", finish, { passive: true });
  });

  onCleanup(() => {
    page.removeEventListener("touchstart", onTouchStart);
    page.removeEventListener("touchmove", onTouchMove);
    page.removeEventListener("touchend", finish);
    page.removeEventListener("touchcancel", finish);
    if (navTimer !== undefined) window.clearTimeout(navTimer);
  });

  return (
    <div ref={page} class="edge-swipe-page min-h-dvh bg-[color:var(--color-bg)]">
      <div
        ref={shade}
        aria-hidden="true"
        class="edge-swipe-shade pointer-events-none fixed inset-0 z-50 opacity-0"
      />
      {props.children}
    </div>
  );
}
