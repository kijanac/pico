import type { AgentActionView } from "./types";

export interface AgentActionsState {
  readonly open: boolean;
  readonly view: AgentActionView;
  readonly error: string | null;
  setOpen(open: boolean): void;
  setView(view: AgentActionView): void;
  setError(message: string | null): void;
  close(): void;
  back(): void;
  done(): void;
}

export function createAgentActionsState(): AgentActionsState {
  let open = $state(false);
  let view = $state<AgentActionView>("menu");
  let error = $state<string | null>(null);

  // The view resets when the sheet opens, so a closing sheet keeps showing
  // what it showed while it slides away.
  function close(): void {
    open = false;
  }

  function back(): void {
    view = "menu";
    error = null;
  }

  function done(): void {
    close();
  }

  return {
    get open() {
      return open;
    },
    get view() {
      return view;
    },
    get error() {
      return error;
    },
    setOpen(next: boolean) {
      if (next && !open) {
        view = "menu";
        error = null;
      }
      open = next;
    },
    setView(next: AgentActionView) {
      view = next;
      error = null;
    },
    setError(message: string | null) {
      error = message;
    },
    close,
    back,
    done,
  };
}
