import type { JSX } from "solid-js";
import BottomSheet from "~/components/BottomSheet";
import type { AgentActionView } from "./types";

const titles: Record<AgentActionView, string> = {
  menu: "agent",
  models: "model",
  compact: "compact context",
  settings: "session settings",
  tree: "tree",
  auth: "provider sign-in",
  info: "session info",
};

export default function AgentActionSheet(props: {
  view: AgentActionView;
  error: string | null;
  onBack: () => void;
  onClose: () => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <BottomSheet
      open
      title={titles[props.view]}
      error={props.error}
      onBack={props.view === "menu" ? undefined : props.onBack}
      onClose={props.onClose}
    >
      {props.children}
    </BottomSheet>
  );
}
