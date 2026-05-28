import type { JSX } from "solid-js";
import { Info, ListTree, Settings } from "lucide-solid";
import { MenuButton } from "./shared";

export default function MenuView(props: {
  onModels: () => void;
  onCompact: () => void;
  onSettings: () => void;
  onTree: () => void;
  onInfo: () => void;
  onAuth: () => void;
}): JSX.Element {
  return (
    <div class="space-y-2 px-3 py-3">
      <MenuButton title="provider sign-in" description="configure model provider auth from the phone" onClick={props.onAuth} />
      <MenuButton title="model" description="choose the model for this session" onClick={props.onModels} />
      <MenuButton title="compact context" description="summarize older context for future turns" onClick={props.onCompact} />
      <MenuButton title="tree" description="jump to an earlier node in this conversation" onClick={props.onTree} icon={<ListTree size={13} />} />
      <MenuButton title="session settings" description="thinking, queueing, compaction, and retry behavior" onClick={props.onSettings} icon={<Settings size={13} />} />
      <MenuButton title="session info" description="file, tokens, cost, and message counts" onClick={props.onInfo} icon={<Info size={13} />} />
    </div>
  );
}
