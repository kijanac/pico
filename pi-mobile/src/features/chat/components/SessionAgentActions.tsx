import { Show, createSignal } from "solid-js";
import { MoreHorizontal } from "lucide-solid";
import { haptic } from "@/lib/haptics";
import AgentActionSheet from "@/features/chat/actions/AgentActionSheet";
import AuthView from "@/features/chat/actions/AuthView";
import CompactView from "@/features/chat/actions/CompactView";
import MenuView from "@/features/chat/actions/MenuView";
import ModelPicker from "@/features/chat/actions/ModelPicker";
import SessionInfoView from "@/features/chat/actions/SessionInfoView";
import SessionSettingsView from "@/features/chat/actions/SessionSettingsView";
import TreeView from "@/features/chat/actions/TreeView";
import type { AgentActionView } from "@/features/chat/actions/types";

interface Props {
  sessionId: string;
}

export default function SessionAgentActions(props: Props) {
  const [open, setOpen] = createSignal(false);
  const [view, setView] = createSignal<AgentActionView>("menu");
  const [error, setError] = createSignal<string | null>(null);

  function close() {
    setOpen(false);
    setView("menu");
    setError(null);
  }

  function back() {
    setView("menu");
    setError(null);
  }

  function done() {
    haptic.success();
    close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        class="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
        aria-label="Agent actions"
        title="Agent actions"
      >
        <MoreHorizontal size={16} />
      </button>

      <Show when={open()}>
        <AgentActionSheet view={view()} error={error()} onBack={back} onClose={close}>
          <Show when={view() === "menu"}>
            <MenuView
              onModels={() => setView("models")}
              onCompact={() => setView("compact")}
              onSettings={() => setView("settings")}
              onTree={() => setView("tree")}
              onInfo={() => setView("info")}
              onAuth={() => setView("auth")}
            />
          </Show>
          <Show when={view() === "models"}>
            <ModelPicker sessionId={props.sessionId} onError={setError} />
          </Show>
          <Show when={view() === "compact"}>
            <CompactView sessionId={props.sessionId} onDone={done} onError={setError} />
          </Show>
          <Show when={view() === "settings"}>
            <SessionSettingsView sessionId={props.sessionId} onError={setError} />
          </Show>
          <Show when={view() === "tree"}>
            <TreeView sessionId={props.sessionId} onDone={done} onError={setError} />
          </Show>
          <Show when={view() === "info"}>
            <SessionInfoView sessionId={props.sessionId} />
          </Show>
          <Show when={view() === "auth"}>
            <AuthView onError={setError} />
          </Show>
        </AgentActionSheet>
      </Show>
    </>
  );
}
