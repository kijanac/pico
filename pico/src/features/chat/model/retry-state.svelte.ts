import type { WireEvent } from "@pico/protocol";

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}

let activeRetry = $state<RetryState | null>(null);

export const retryState = {
  get active() {
    return activeRetry;
  },

  reset(): void {
    activeRetry = null;
  },

  applyWireEvent(event: WireEvent): void {
    if (event.t === "auto_retry_start") {
      activeRetry = {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
      };
      return;
    }

    if (event.t === "auto_retry_end") {
      activeRetry = null;
    }
  },
};
