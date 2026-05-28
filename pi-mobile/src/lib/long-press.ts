interface LongPressOptions {
  delayMs: number;
  moveCancelPx?: number;
  enabled?: () => boolean;
  onStart?: () => void;
  onCancel?: () => void;
  onLongPress: () => void;
}

export function createLongPress(opts: LongPressOptions) {
  let timer: number | undefined;
  let origin: { x: number; y: number } | null = null;
  let fired = false;

  const clear = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    origin = null;
    opts.onCancel?.();
  };

  return {
    start(e?: PointerEvent) {
      if (opts.enabled && !opts.enabled()) return;
      clear();
      fired = false;
      origin = e ? { x: e.clientX, y: e.clientY } : null;
      opts.onStart?.();
      timer = window.setTimeout(() => {
        timer = undefined;
        fired = true;
        opts.onCancel?.();
        opts.onLongPress();
      }, opts.delayMs);
    },
    move(e: PointerEvent) {
      if (timer === undefined || !origin || opts.moveCancelPx === undefined) return;
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > opts.moveCancelPx) {
        clear();
      }
    },
    end: clear,
    consumeClick() {
      if (!fired) return false;
      fired = false;
      return true;
    },
  };
}
