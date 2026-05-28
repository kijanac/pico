import { createContext, createSignal, onCleanup, onMount, useContext, type Accessor, type JSX } from "solid-js";
import { Capacitor } from "@capacitor/core";
import {
  Keyboard,
  KeyboardResize,
  KeyboardStyle,
} from "@capacitor/keyboard";

export type KeyboardAvoidanceMode = "native" | "manual";

const [keyboardHeight, setKeyboardHeight] = createSignal(0);
export { keyboardHeight };

const KeyboardAvoidanceContext = createContext<KeyboardAvoidanceMode>("native");

let listenersInitialized = false;
let manualResizeLocks = 0;

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Global keyboard event tracking. This only tracks keyboard frame changes;
 * resize strategy is selected explicitly by KeyboardAvoidance.
 */
export function ensureKeyboardTracking(): void {
  if (listenersInitialized) return;
  listenersInitialized = true;

  if (!isNative()) return;

  void Keyboard.setStyle({ style: KeyboardStyle.Dark }).catch(() => {});

  void Keyboard.addListener("keyboardWillShow", (info) => {
    setKeyboardHeight(info.keyboardHeight ?? 0);
  });
  void Keyboard.addListener("keyboardDidShow", (info) => {
    setKeyboardHeight(info.keyboardHeight ?? 0);
  });
  void Keyboard.addListener("keyboardWillHide", () => {
    setKeyboardHeight(0);
  });
  void Keyboard.addListener("keyboardDidHide", () => {
    setKeyboardHeight(0);
  });
}

function acquireManualResize(): void {
  ensureKeyboardTracking();
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
    setKeyboardHeight(0);
    void Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {});
  }
}

export function KeyboardAvoidance(props: {
  mode: KeyboardAvoidanceMode;
  children: JSX.Element;
}): JSX.Element {
  onMount(() => {
    ensureKeyboardTracking();
    if (props.mode === "manual") acquireManualResize();
  });

  onCleanup(() => {
    if (props.mode === "manual") releaseManualResize();
  });

  return (
    <KeyboardAvoidanceContext.Provider value={props.mode}>
      {props.children}
    </KeyboardAvoidanceContext.Provider>
  );
}

export function useKeyboardAvoidanceMode(): KeyboardAvoidanceMode {
  return useContext(KeyboardAvoidanceContext);
}

export function useKeyboardInset(options?: { enabled?: Accessor<boolean> }): Accessor<number> {
  const mode = useKeyboardAvoidanceMode();
  return () => (mode === "manual" && (options?.enabled?.() ?? true) ? keyboardHeight() : 0);
}
