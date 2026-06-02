import { haptics } from "@/shared/mobile/haptics";
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

  function close(): void {
    open = false;
    view = "menu";
    error = null;
  }

  function back(): void {
    view = "menu";
    error = null;
  }

  function done(): void {
    haptics.success();
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
      open = next;
      if (!next) close();
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
