import type { UserMessage } from "@pi-mobile/protocol";
import type { JSX } from "solid-js";

export default function UserMessageView(props: { msg: UserMessage }): JSX.Element {
  return (
    <div class="flex justify-end px-3 py-1.5">
      <div class="max-w-[85%] rounded-[var(--radius-md)] bg-[color:var(--color-surface-2)] px-3 py-2 text-[13px] leading-[1.55] text-[color:var(--color-fg)]">
        {props.msg.text}
      </div>
    </div>
  );
}
