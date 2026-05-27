import { Show, type JSX } from "solid-js";
import { AlertCircle, XCircle, AlertTriangle } from "lucide-solid";
import type { AssistantMessage } from "@pi-mobile/protocol";
import StreamingMarkdown from "./StreamingMarkdown";

/**
 * Render an assistant turn. When `stopReason` is anything other than
 * the success values ("stop" / "toolUse"), append an inline banner so
 * the user understands why the model stopped:
 *
 *   error    — provider/network failure; show errorMessage in red
 *   aborted  — interrupted by the user (or /interrupt); muted red
 *   length   — hit max-output-tokens; amber, since the reply is real
 *              but truncated and a follow-up may be needed
 *
 * "stop" and "toolUse" render with no banner — the latter because the
 * tool calls themselves are visible as separate entries below.
 */
export default function AssistantMessageView(props: {
  msg: AssistantMessage;
}): JSX.Element {
  const showBanner = () => {
    const r = props.msg.stopReason;
    return r === "error" || r === "aborted" || r === "length";
  };

  return (
    <div class="px-3 py-1.5 text-[13px] leading-[1.6] text-[color:var(--color-fg)]">
      <Show when={props.msg.text.length > 0}>
        <StreamingMarkdown
          text={props.msg.text}
          done={!props.msg.streaming}
        />
      </Show>
      <Show when={props.msg.streaming}>
        <span
          aria-hidden="true"
          class="ml-0.5 inline-block h-[1em] w-[0.4em] translate-y-[0.15em] bg-[color:var(--color-accent)] animate-pulse"
        />
      </Show>

      <Show when={showBanner()}>
        <ErrorBanner
          stopReason={props.msg.stopReason!}
          errorMessage={props.msg.errorMessage}
        />
      </Show>
    </div>
  );
}

function ErrorBanner(props: {
  stopReason: "error" | "aborted" | "length" | "stop" | "toolUse";
  errorMessage?: string;
}): JSX.Element {
  const tone = () => {
    switch (props.stopReason) {
      case "error":
        return {
          color: "text-[color:var(--color-danger)]",
          icon: <XCircle size={12} />,
          label: "error",
        };
      case "aborted":
        return {
          color: "text-[color:var(--color-fg-muted)]",
          icon: <AlertCircle size={12} />,
          label: "interrupted",
        };
      case "length":
        return {
          color: "text-[color:var(--color-warning,#d97706)]",
          icon: <AlertTriangle size={12} />,
          label: "output truncated (max tokens reached)",
        };
      default:
        return null;
    }
  };

  return (
    <Show when={tone()}>
      {(t) => (
        <div
          class={`mt-1.5 flex items-start gap-1.5 text-[11px] ${t().color}`}
        >
          <span class="mt-[2px] shrink-0">{t().icon}</span>
          <div class="min-w-0 flex-1">
            <div class="font-medium">{t().label}</div>
            <Show when={props.errorMessage}>
              <div class="mt-0.5 break-words opacity-80">
                {props.errorMessage}
              </div>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
