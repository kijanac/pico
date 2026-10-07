
const THRESHOLD = 64;
const MAX_PULL = 110;
const RUBBER_BAND = 0.45;

export interface PullToRefreshOptions {
  content: HTMLElement;
  indicator: HTMLElement;
  icon: HTMLElement;
  onRefresh: () => Promise<void>;
}

export function createPullToRefresh(container: HTMLElement, options: PullToRefreshOptions) {
  let pull = 0;
  let refreshing = false;
  let startY: number | null = null;
  let destroyed = false;

  const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function progress(): number {
    return Math.min(1, pull / THRESHOLD);
  }

  function render(): void {
    const visible = pull > 0 || refreshing;
    const still = reducedMotion();
    options.indicator.hidden = !visible;
    options.indicator.style.height = `${pull}px`;
    options.indicator.style.transition = refreshing ? "height 120ms ease-out" : "none";
    options.icon.style.opacity = String(refreshing ? 1 : progress());
    // Skip the rotate-follow and the infinite spin under reduced motion; opacity alone conveys progress.
    options.icon.style.transform = refreshing || still ? "" : `rotate(${progress() * 360}deg)`;
    options.icon.style.animation = refreshing && !still ? "spin 1s linear infinite" : "none";
    options.content.style.transform = `translateY(${pull}px)`;
    options.content.style.transition = pull === 0 || refreshing ? "transform 120ms ease-out" : "none";
  }

  function setPull(next: number): void {
    pull = next;
    render();
  }

  function onTouchStart(event: TouchEvent): void {
    if (refreshing || event.touches.length !== 1) return;
    if (container.scrollTop > 0) {
      startY = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    startY = touch.clientY;
  }

  function onTouchMove(event: TouchEvent): void {
    if (startY === null || refreshing) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dy = touch.clientY - startY;
    // A row's sideways swipe claimed the touch (it prevents the default).
    if (dy <= 0 || event.defaultPrevented) {
      setPull(0);
      startY = null;
      return;
    }
    const eased = Math.min(MAX_PULL, dy * RUBBER_BAND);
    setPull(eased);
  }

  function onTouchEnd(): void {
    // A touch while refreshing leaves the spinner where it is.
    if (refreshing) {
      startY = null;
      return;
    }
    if (startY === null) {
      setPull(0);
      return;
    }
    if (pull >= THRESHOLD) {
      setPull(THRESHOLD);
      refreshing = true;
      render();
      void options
        .onRefresh()
        .catch((error) => console.warn("[ptr] onRefresh threw:", error))
        .finally(() => {
          if (destroyed) return;
          refreshing = false;
          setPull(0);
        });
    } else {
      setPull(0);
    }
    startY = null;
  }

  // The system took the touch: put the list back without refreshing.
  function onTouchCancel(): void {
    if (refreshing) return;
    startY = null;
    setPull(0);
  }

  container.addEventListener("touchstart", onTouchStart, { passive: true });
  container.addEventListener("touchmove", onTouchMove, { passive: true });
  container.addEventListener("touchend", onTouchEnd, { passive: true });
  container.addEventListener("touchcancel", onTouchCancel, { passive: true });
  render();

  return {
    destroy(): void {
      destroyed = true;
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchCancel);
      options.indicator.hidden = true;
      options.indicator.style.height = "";
      options.indicator.style.transition = "";
      options.icon.style.opacity = "";
      options.icon.style.transform = "";
      options.icon.style.animation = "";
      options.content.style.transform = "";
      options.content.style.transition = "";
    },
  };
}
