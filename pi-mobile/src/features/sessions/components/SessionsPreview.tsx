import { For, Show, type JSX } from "solid-js";
import { GitBranch, Plus, Settings as SettingsIcon } from "lucide-solid";
import Header from "~/components/Header";
import StatusDot from "~/components/StatusDot";
import { sessions } from "~/stores/sessions";
import { connState } from "~/stores/connection";
import { relativeTime, shortPath, formatCost } from "~/lib/format";

/**
 * Non-interactive sessions-list snapshot used behind edge-swipe-back routes.
 * It intentionally shares the live sessions store but avoids refreshes, links,
 * sheets, and pointer handlers so the underlay is visually faithful without
 * becoming another active screen.
 */
export default function SessionsPreview(): JSX.Element {
  return (
    <div class="flex min-h-dvh flex-col bg-[color:var(--color-bg)]">
      <Header
        trailing={
          <div class="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)]">
            <SettingsIcon size={16} />
          </div>
        }
      >
        <div class="flex items-baseline gap-2">
          <span class="text-[13px] font-medium">sessions</span>
          <span class="label">{sessions().length}</span>
        </div>
      </Header>

      <Show
        when={sessions().length > 0}
        fallback={
          <Show when={connState() === "connected"} fallback={null}>
            <div class="flex flex-1 items-center justify-center px-6 text-center">
              <p class="text-[12px] text-[color:var(--color-fg-faint)]">
                no sessions yet — tap{" "}
                <span class="text-[color:var(--color-fg-muted)]">new session</span>{" "}
                below.
              </p>
            </div>
          </Show>
        }
      >
        <div class="flex-1 overflow-hidden">
          <For each={sessions()}>
            {(s) => (
              <div class="hairline-b block px-3 py-3">
                <div class="mb-1 flex items-center gap-2">
                  <StatusDot status={s.status} />
                  <span class="min-w-0 flex-1 truncate text-[13px] leading-tight">
                    {s.title}
                  </span>
                  <span class="text-[10px] tabular-nums text-[color:var(--color-fg-faint)]">
                    {relativeTime(s.updatedAt)}
                  </span>
                </div>
                <div class="flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
                  <span class="truncate">{shortPath(s.cwd, 2)}</span>
                  <Show when={s.branch}>
                    <span class="flex shrink-0 items-center gap-1">
                      <GitBranch size={10} />
                      {s.branch}
                    </span>
                  </Show>
                  <span class="ml-auto shrink-0 tabular-nums">
                    {formatCost(s.costUsd)}
                  </span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div
        class="hairline-t sticky bottom-0 bg-[color:var(--color-bg)]/95 p-2"
        style={{ "padding-bottom": "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
      >
        <div class="flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-strong)] text-[12px] text-[color:var(--color-fg-muted)]">
          <Plus size={14} />
          new session
        </div>
      </div>
    </div>
  );
}
