import { createSignal, Show, type JSX } from "solid-js";
import {
  FileText,
  Pencil,
  PlusSquare,
  Terminal,
  Check,
  X,
  Loader2,
} from "lucide-solid";
import type { ToolCallMessage, ToolName } from "@pi-mobile/protocol";
import { shortPath } from "~/lib/format";
import EditDiff from "./EditDiff";
import ToolResult from "./ToolResult";

const ICONS: Record<ToolName, (p: { size: number }) => JSX.Element> = {
  read: (p) => <FileText size={p.size} />,
  write: (p) => <PlusSquare size={p.size} />,
  edit: (p) => <Pencil size={p.size} />,
  bash: (p) => <Terminal size={p.size} />,
};

function summary(msg: ToolCallMessage): string {
  switch (msg.tool) {
    case "read":
    case "write":
    case "edit":
      return shortPath(String(msg.args.path ?? ""), 2);
    case "bash":
      return String(msg.args.cmd ?? "");
  }
}

/**
 * Expanded view dispatcher.
 *
 *   edit  — unified diff (args contains old/new text or an edits array).
 *   else  — ToolResult picks the right per-tool renderer (bash ANSI,
 *           read/write syntax highlighting, raw pre fallback).
 */
function ExpandedView(props: { msg: ToolCallMessage }): JSX.Element {
  return (
    <Show
      when={props.msg.tool === "edit"}
      fallback={
        <Show when={props.msg.result || props.msg.args.content}>
          <ToolResult msg={props.msg} />
        </Show>
      }
    >
      <div class="mt-1">
        <EditDiff args={props.msg.args} />
      </div>
    </Show>
  );
}

export default function ToolCallView(props: {
  msg: ToolCallMessage;
}): JSX.Element {
  // Edit blocks expand by default — the diff is the point. Other tools
  // stay collapsed until tapped so the chat doesn't get noisy.
  const [open, setOpen] = createSignal(props.msg.tool === "edit");
  const Icon = ICONS[props.msg.tool];

  return (
    <div class="px-3 py-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="group flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 py-1.5 text-left active:bg-[color:var(--color-surface-2)]"
      >
        <span class="flex h-4 w-4 items-center justify-center text-[color:var(--color-fg-muted)]">
          <Icon size={12} />
        </span>

        <span class="text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">
          {props.msg.tool}
        </span>

        <span class="min-w-0 flex-1 truncate text-[12px] text-[color:var(--color-fg)]">
          {summary(props.msg)}
        </span>

        <Show when={props.msg.status === "running"}>
          <Loader2
            size={12}
            class="pulse-accent text-[color:var(--color-accent)]"
            style={{ animation: "spin 1s linear infinite" }}
          />
        </Show>
        <Show when={props.msg.status === "ok"}>
          <Check size={12} class="text-[color:var(--color-fg-faint)]" />
          <Show when={props.msg.durationMs !== undefined}>
            <span class="text-[10px] text-[color:var(--color-fg-faint)] tabular-nums">
              {props.msg.durationMs}ms
            </span>
          </Show>
        </Show>
        <Show when={props.msg.status === "error"}>
          <X size={12} class="text-[color:var(--color-danger)]" />
        </Show>
      </button>

      <Show when={open()}>
        <ExpandedView msg={props.msg} />
      </Show>
    </div>
  );
}
