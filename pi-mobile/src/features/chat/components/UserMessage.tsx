import type { UserMessage } from "@pi-mobile/protocol";

export default function UserMessageView(props: { msg: UserMessage }) {
  return (
    <div class="flex justify-end px-3 py-1.5">
      <div
        class="max-w-[85%] min-w-0 overflow-hidden break-words rounded-[var(--radius-md)] px-3 py-2 text-[13px] leading-[1.55]"
        classList={{
          "border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[color:var(--color-fg-muted)] opacity-90": !!props.msg.queued,
          "bg-[color:var(--color-surface-2)] text-[color:var(--color-fg)]": !props.msg.queued,
        }}
      >
        {props.msg.text}
      </div>
    </div>
  );
}
