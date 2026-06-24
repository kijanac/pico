import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

export interface SpeechRecognitionState {
  readonly available: boolean | null;
  readonly listening: boolean;
  readonly transcript: string;
  checkAvailability: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<string>;
  reset: () => void;
  destroy: () => void;
}

export function createSpeechRecognitionState(opts?: { language?: string }): SpeechRecognitionState {
  const language = opts?.language ?? "en-US";

  let available = $state<boolean | null>(null);
  let listening = $state(false);
  let transcript = $state("");
  let partialHandle: PluginListenerHandle | null = null;
  let stateHandle: PluginListenerHandle | null = null;
  let destroyed = false;

  async function checkAvailability(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      available = false;
      return;
    }

    try {
      const result = await SpeechRecognition.available();
      if (!destroyed) available = !!result.available;
    } catch (error) {
      console.warn("[stt] available() failed:", error);
      if (!destroyed) available = false;
    }
  }

  async function ensurePermission(): Promise<boolean> {
    try {
      const status = await SpeechRecognition.checkPermissions();
      if (status.speechRecognition === "granted") return true;
      const requested = await SpeechRecognition.requestPermissions();
      return requested.speechRecognition === "granted";
    } catch (error) {
      console.warn("[stt] permission flow failed:", error);
      return false;
    }
  }

  async function attachListeners(): Promise<void> {
    if (partialHandle) return;

    partialHandle = await SpeechRecognition.addListener("partialResults", ({ matches }) => {
      if (matches && matches.length > 0) transcript = matches[0] ?? "";
    });

    stateHandle = await SpeechRecognition.addListener("listeningState", ({ status }) => {
      listening = status === "started";
    });
  }

  async function detachListeners(): Promise<void> {
    try {
      await partialHandle?.remove();
    } catch {}
    try {
      await stateHandle?.remove();
    } catch {}
    partialHandle = null;
    stateHandle = null;
  }

  async function start(): Promise<void> {
    if (available === null) await checkAvailability();
    if (!available || listening) return;
    if (!(await ensurePermission())) return;

    transcript = "";
    listening = true;
    await attachListeners();

    try {
      await SpeechRecognition.start({
        language,
        partialResults: true,
        popup: false,
      });
    } catch (error) {
      console.warn("[stt] start() failed:", error);
      listening = false;
      await detachListeners();
    }
  }

  async function stop(): Promise<string> {
    if (!listening && !partialHandle) return transcript;

    try {
      await SpeechRecognition.stop();
    } catch (error) {
      console.warn("[stt] stop() failed:", error);
    }

    listening = false;
    await detachListeners();
    return transcript;
  }

  function reset(): void {
    transcript = "";
  }

  function destroy(): void {
    destroyed = true;
    if (listening || partialHandle) {
      void (async () => {
        try {
          await SpeechRecognition.stop();
        } catch {}
        await detachListeners();
      })();
    }
  }

  return {
    get available() {
      return available;
    },
    get listening() {
      return listening;
    },
    get transcript() {
      return transcript;
    },
    checkAvailability,
    start,
    stop,
    reset,
    destroy,
  };
}
