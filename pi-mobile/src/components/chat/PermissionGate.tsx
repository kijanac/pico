import { Show, type JSX } from "solid-js";
import { Terminal, Shield } from "lucide-solid";
import type { PermissionRequest } from "@pi-mobile/protocol";
import { resolvePermissionLocal } from "~/stores/sessions";
import { activeSend } from "~/stores/connection";

interface Props {
  req: PermissionRequest;
}

export default function PermissionGate(props: Props): JSX.Element {
  const resolved = () => props.req.resolved !== undefined;

  function choose(choice: "allow" | "deny" | "allow_session") {
    // Optimistic UI: collapse the gate immediately. Bridge will catch up
    // via subsequent events.
    resolvePermissionLocal(props.req.id, choice);
    activeSend()?.({ t: "permission_reply", id: props.req.id, choice });
  }

  return (
    <Show
      when={!resolved()}
      fallback={
        <div class="mx-3 my-2 rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-border)] px-2.5 py-1.5">
          <span class="label">{props.req.resolved} · {props.req.tool}</span>
        </div>
      }
    >
      <div class="mx-3 my-2 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-accent)]/40">
        <div class="flex items-center gap-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-accent-dim)] px-3 py-2">
          <Shield size={12} class="text-[color:var(--color-accent)]" />
          <span class="text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-accent)]">
            permission required
          </span>
        </div>

        <div class="bg-[color:var(--color-surface)] p-3">
          <div class="mb-2 flex items-center gap-2 text-[color:var(--color-fg-muted)]">
            <Terminal size={12} />
            <span class="label">{props.req.tool}</span>
          </div>
          <pre class="mb-3 overflow-x-auto rounded-[var(--radius-sm)] bg-[color:var(--color-bg)] p-2 text-[12px] leading-[1.5]">
            {String(props.req.args.cmd ?? JSON.stringify(props.req.args, null, 2))}
          </pre>
          <Show when={props.req.rationale}>
            <p class="mb-3 text-[12px] leading-[1.55] text-[color:var(--color-fg-muted)]">
              {props.req.rationale}
            </p>
          </Show>

          <div class="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => choose("deny")}
              class="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-2 py-2 text-[12px] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface-2)]"
            >
              deny
            </button>
            <button
              type="button"
              onClick={() => choose("allow")}
              class="rounded-[var(--radius-sm)] border border-[color:var(--color-border-strong)] px-2 py-2 text-[12px] text-[color:var(--color-fg)] active:bg-[color:var(--color-surface-2)]"
            >
              allow once
            </button>
            <button
              type="button"
              onClick={() => choose("allow_session")}
              class="rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] px-2 py-2 text-[12px] font-medium text-[color:var(--color-bg)] active:opacity-80"
            >
              session
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
