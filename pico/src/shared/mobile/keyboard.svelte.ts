import { Capacitor } from "@capacitor/core";
import { Keyboard, KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

export type KeyboardAvoidanceMode = "native" | "manual";

let installed = false;
let manualResizeLocks = 0;
let nativeKeyboardHeight = $state(0);
let viewportKeyboardHeight = $state(0);

const keyboardHeight = $derived(Math.max(nativeKeyboardHeight, viewportKeyboardHeight));

export const keyboardState = {
  get height() {
    return keyboardHeight;
  },

  get nativeHeight() {
    return nativeKeyboardHeight;
  },

  get viewportHeight() {
    return viewportKeyboardHeight;
  },

  install(): void {
    installKeyboardTracking();
  },

  acquireManualResize(): void {
    acquireManualResize();
  },

  releaseManualResize(): void {
    releaseManualResize();
  },
};

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

function installKeyboardTracking(): void {
  if (installed) return;
  installed = true;

  window.visualViewport?.addEventListener("resize", updateViewportKeyboardHeight);
  window.visualViewport?.addEventListener("scroll", updateViewportKeyboardHeight);
  window.addEventListener("resize", updateViewportKeyboardHeight);
  updateViewportKeyboardHeight();

  if (!isNative()) return;

  void Keyboard.setStyle({ style: KeyboardStyle.Dark }).catch(() => {});

  void Keyboard.addListener("keyboardWillShow", (info) => {
    nativeKeyboardHeight = info.keyboardHeight ?? 0;
  });
  void Keyboard.addListener("keyboardDidShow", (info) => {
    nativeKeyboardHeight = info.keyboardHeight ?? 0;
  });
  void Keyboard.addListener("keyboardWillHide", () => {
    nativeKeyboardHeight = 0;
    updateViewportKeyboardHeight();
  });
  void Keyboard.addListener("keyboardDidHide", () => {
    nativeKeyboardHeight = 0;
    updateViewportKeyboardHeight();
  });
}

function updateViewportKeyboardHeight(): void {
  const visualViewport = window.visualViewport;
  if (!visualViewport) {
    viewportKeyboardHeight = 0;
    return;
  }

  const occluded = window.innerHeight - visualViewport.height - visualViewport.offsetTop;
  viewportKeyboardHeight = Math.max(0, Math.round(occluded));
}

function acquireManualResize(): void {
  installKeyboardTracking();
  if (!isNative()) return;

  manualResizeLocks += 1;
  if (manualResizeLocks === 1) {
    void Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {});
  }
}

function releaseManualResize(): void {
  if (!isNative()) return;

  manualResizeLocks = Math.max(0, manualResizeLocks - 1);
  if (manualResizeLocks === 0) {
    nativeKeyboardHeight = 0;
    viewportKeyboardHeight = 0;
    void Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {});
  }
}
