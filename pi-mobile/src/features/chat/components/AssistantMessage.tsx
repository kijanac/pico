import { Show, createSignal, type JSX } from "solid-js";
import { AlertCircle, Check, Copy, Info, XCircle, AlertTriangle } from "lucide-solid";
import type { AssistantMessage } from "@pi-mobile/protocol";
import BottomSheet from "~/components/BottomSheet";
import { Button } from "~/components/ui/button";
import StreamingMarkdown from "./StreamingMarkdown";
import { formatCost, formatTokens } from "~/lib/format";

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
  const [copied, setCopied] = createSignal(false);
  const [detailsOpen, setDetailsOpen] = createSignal(false);

  const showBanner = () => {
    const r = props.msg.stopReason;
    return r === "error" || r === "aborted" || r === "length";
  };
  const showActions = () => !props.msg.streaming && props.msg.text.length > 0;

  async function copyText() {
    await navigator.clipboard?.writeText(props.msg.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 900);
  }

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

      <Show when={showActions()}>
        <div class="mt-1 flex justify-end gap-1 text-[color:var(--color-fg-faint)]">
          <IconButton
            label={copied() ? "Copied" : "Copy message"}
            onClick={copyText}
          >
            <Show when={copied()} fallback={<Copy size={13} />}>
              <Check size={13} />
            </Show>
          </IconButton>
          <IconButton
            label="Message details"
            onClick={() => setDetailsOpen(true)}
          >
            <Info size={13} />
          </IconButton>
        </div>
      </Show>

      <MessageDetailsSheet
        open={detailsOpen()}
        msg={props.msg}
        onClose={() => setDetailsOpen(false)}
      />
    </div>
  );
}

function MessageDetailsSheet(props: {
  open: boolean;
  msg: AssistantMessage;
  onClose: () => void;
}): JSX.Element {
  const usage = () => props.msg.usage;

  return (
    <Show when={props.open}>
      <BottomSheet open title="message details" onClose={props.onClose} contentClass="px-3 pb-3">
        <Show
          when={usage()}
          fallback={
            <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-[12px] text-[color:var(--color-fg-faint)]">
              usage is not available for this message
            </div>
          }
        >
          {(u) => (
            <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-[12px]">
              <InfoRow label="input" value={formatTokens(u().input)} />
              <InfoRow label="output" value={formatTokens(u().output)} />
              <InfoRow label="cache read" value={formatTokens(u().cacheRead)} />
              <InfoRow label="cache write" value={formatTokens(u().cacheWrite)} />
              <InfoRow label="total" value={formatTokens(u().total)} />
              <InfoRow label="cost" value={formatCost(u().cost)} />
            </div>
          )}
        </Show>
      </BottomSheet>
    </Show>
  );
}

function InfoRow(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="flex items-center justify-between gap-3 py-1">
      <span class="text-[color:var(--color-fg-faint)]">{props.label}</span>
      <span class="font-mono tabular-nums text-[color:var(--color-fg)]">{props.value}</span>
    </div>
  );
}

function IconButton(props: {
  label: string;
  onClick: () => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      class="h-7 w-7 text-[color:var(--color-fg-faint)] active:text-[color:var(--color-fg-muted)]"
    >
      {props.children}
    </Button>
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
