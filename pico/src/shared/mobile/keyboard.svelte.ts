import { flushSync } from "svelte";
import { projectViewport, sameViewportFrame, type ViewportFrame } from "./viewport";

let frame = $state<ViewportFrame | null>(null);
let users = 0;
let pendingFrame: number | null = null;

function updateViewport(): boolean {
  const next = projectViewport({ width: window.innerWidth, height: window.innerHeight }, window.visualViewport);
  if (!next || sameViewportFrame(frame, next)) return false;
  frame = next;
  return true;
}

function syncViewport(): void {
  if (updateViewport()) flushSync();
}

function finishViewportUpdate(): void {
  pendingFrame = null;
  if (users > 0) syncViewport();
}

function refreshViewport(): void {
  if (users === 0) return;
  syncViewport();
  if (users > 0 && pendingFrame === null) {
    pendingFrame = window.requestAnimationFrame(() => {
      if (users === 0) return;
      syncViewport();
      if (users > 0) pendingFrame = window.requestAnimationFrame(finishViewportUpdate);
    });
  }
}

function updateWhenVisible(): void {
  if (!document.hidden) refreshViewport();
}

function release(): void {
  users -= 1;
  if (users > 0) return;
  window.visualViewport?.removeEventListener("resize", refreshViewport);
  window.visualViewport?.removeEventListener("scroll", refreshViewport);
  window.removeEventListener("resize", refreshViewport);
  window.removeEventListener("scroll", refreshViewport);
  window.removeEventListener("pageshow", refreshViewport);
  document.removeEventListener("visibilitychange", updateWhenVisible);
  if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
  frame = null;
}

export const keyboardState = {
  get height() { return frame?.coveredHeight ?? 0; },
  get viewport() { return frame; },

  install(): () => void {
    users += 1;
    if (users === 1) {
      window.visualViewport?.addEventListener("resize", refreshViewport);
      window.visualViewport?.addEventListener("scroll", refreshViewport);
      window.addEventListener("resize", refreshViewport);
      window.addEventListener("scroll", refreshViewport);
      window.addEventListener("pageshow", refreshViewport);
      document.addEventListener("visibilitychange", updateWhenVisible);
      updateViewport();
    }
    return release;
  },
};
