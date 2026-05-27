import { type JSX } from "solid-js";
import type { SessionStatus } from "@pi-mobile/protocol";

interface Props {
  status: SessionStatus;
  size?: number;
  class?: string;
}

const COLOR: Record<SessionStatus, string> = {
  idle: "var(--color-fg-faint)",
  thinking: "var(--color-accent)",
  tool: "var(--color-accent)",
  waiting: "var(--color-warn)",
  error: "var(--color-danger)",
};

const isActive = (s: SessionStatus) => s === "thinking" || s === "tool";

export default function StatusDot(props: Props): JSX.Element {
  const size = () => `${props.size ?? 6}px`;
  return (
    <span
      class={props.class}
      classList={{ "pulse-accent": isActive(props.status) }}
      style={{
        display: "inline-block",
        width: size(),
        height: size(),
        "border-radius": "999px",
        background: COLOR[props.status],
        "box-shadow": isActive(props.status)
          ? "0 0 0 3px var(--color-accent-dim)"
          : "none",
      }}
    />
  );
}
