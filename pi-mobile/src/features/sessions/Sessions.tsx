import { For, Show, createSignal, onMount, type JSX } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { Plus, GitBranch, Settings as SettingsIcon } from "lucide-solid";
import Header from "~/components/Header";
import StatusDot from "~/components/StatusDot";
import PullToRefresh from "~/components/PullToRefresh";
import NewSessionSheet from "~/features/sessions/components/NewSessionSheet";
import SessionActions from "~/features/sessions/components/SessionActions";
import RenameSheet from "~/features/sessions/components/RenameSheet";
import { sessions, loadSessions } from "~/stores/sessions";
import { connState, setConnState } from "~/stores/connection";
import {
  createSession,
  deleteSession,
  healthcheck,
  patchSession,
} from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";
import { haptic } from "~/lib/haptics";
import { createLongPress } from "~/lib/long-press";
import { relativeTime, shortPath, formatCost } from "~/lib/format";
import type { SessionMeta } from "@pi-mobile/protocol";

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 8; // cancel long-press if finger drifts this far

export default function Sessions(): JSX.Element {
  const navigate = useNavigate();
  const [error, setError] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [sheetOpen, setSheetOpen] = createSignal(false);

  // Management sheet state.
  // - actionSession: which row's action menu is open (null = closed)
  // - renameTarget: which session is being renamed (null = closed)
  // - saving: tracks an in-flight rename for the save-button spinner
  const [actionSession, setActionSession] = createSignal<SessionMeta | null>(
    null,
  );
  const [renameTarget, setRenameTarget] = createSignal<SessionMeta | null>(
    null,
  );
  const [saving, setSaving] = createSignal(false);

  const refresh = async () => {
    try {
      const baseUrl = await getBridgeUrl();
      const ok = await healthcheck(baseUrl);
      setConnState(ok ? "connected" : "error");
      if (!ok) {
        setError(`can't reach bridge at ${baseUrl}`);
        return;
      }
      await loadSessions(baseUrl);
      setError(null);
    } catch (e) {
      setError(String(e));
      setConnState("error");
    }
  };

  onMount(refresh);

  const handleCreate = async (opts: {
    cwd: string;
    title: string;
    branch?: string;
  }) => {
    if (creating()) return;
    setCreating(true);
    try {
      const baseUrl = await getBridgeUrl();
      const meta = await createSession(baseUrl, opts);
      await loadSessions(baseUrl);
      setSheetOpen(false);
      navigate(`/s/${meta.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  /* ── management handlers ─────────────────────────────────────────── */

  async function handleRename(newTitle: string) {
    const target = renameTarget();
    if (!target || saving()) return;
    setSaving(true);
    try {
      const baseUrl = await getBridgeUrl();
      await patchSession(baseUrl, target.id, { title: newTitle });
      await loadSessions(baseUrl);
      setRenameTarget(null);
      haptic.success();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleArchive() {
    const target = actionSession();
    if (!target) return;
    try {
      const baseUrl = await getBridgeUrl();
      await patchSession(baseUrl, target.id, { archived: !target.archived });
      await loadSessions(baseUrl);
      setActionSession(null);
      haptic.success();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete() {
    const target = actionSession();
    if (!target) return;
    if (!window.confirm(`Delete “${target.title}”? This cannot be undone.`)) {
      setActionSession(null);
      return;
    }
    try {
      const baseUrl = await getBridgeUrl();
      await deleteSession(baseUrl, target.id);
      await loadSessions(baseUrl);
      setActionSession(null);
      haptic.heavy();
    } catch (e) {
      setError(String(e));
    }
  }

  let pressTarget: SessionMeta | null = null;
  const rowPress = createLongPress({
    delayMs: LONG_PRESS_MS,
    moveCancelPx: LONG_PRESS_MOVE_PX,
    onLongPress: () => {
      if (!pressTarget) return;
      haptic.medium();
      setActionSession(pressTarget);
    },
  });

  function onRowPointerDown(e: PointerEvent, s: SessionMeta) {
    pressTarget = s;
    rowPress.start(e);
  }

  function onRowPointerUp() {
    rowPress.end();
    pressTarget = null;
  }

  function onRowClick(e: MouseEvent) {
    if (!rowPress.consumeClick()) return;
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div class="flex min-h-dvh flex-col">
      <Header
        trailing={
          <A
            href="/settings"
            class="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
            aria-label="Settings"
          >
            <SettingsIcon size={16} />
          </A>
        }
      >
        <div class="flex items-baseline gap-2">
          <span class="text-[13px] font-medium">sessions</span>
          <span class="label">{sessions().length}</span>
        </div>
      </Header>

      <Show when={error()}>
        <div class="mx-3 my-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[12px] text-[color:var(--color-danger)]">
          {error()}
          <button
            type="button"
            onClick={refresh}
            class="ml-2 underline opacity-70 active:opacity-100"
          >
            retry
          </button>
        </div>
      </Show>

      <Show
        when={sessions().length > 0}
        fallback={
          <Show
            when={connState() === "connected" && !error()}
            fallback={null}
          >
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
        <PullToRefresh class="flex-1" onRefresh={refresh}>
          <For each={sessions()}>
            {(s) => (
              <A
                href={`/s/${s.id}`}
                onPointerDown={(e) => onRowPointerDown(e, s)}
                onPointerMove={(e) => rowPress.move(e)}
                onPointerUp={onRowPointerUp}
                onPointerCancel={onRowPointerUp}
                onClick={onRowClick}
                class="hairline-b block px-3 py-3 active:bg-[color:var(--color-surface)]"
              >
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
              </A>
            )}
          </For>
        </PullToRefresh>
      </Show>

      <div
        class="hairline-t sticky bottom-0 bg-[color:var(--color-bg)]/95 backdrop-blur-md p-2"
        style={{ "padding-bottom": "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
      >
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          disabled={connState() !== "connected"}
          class="flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-strong)] text-[12px] active:bg-[color:var(--color-surface)] disabled:opacity-50"
        >
          <Plus size={14} />
          new session
        </button>
      </div>

      <NewSessionSheet
        open={sheetOpen()}
        onCancel={() => setSheetOpen(false)}
        onCreate={handleCreate}
        creating={creating()}
      />

      <SessionActions
        session={actionSession()}
        onClose={() => setActionSession(null)}
        onRename={() => {
          // Transition from action sheet to rename sheet without a
          // closing flicker — pass the target through both signals,
          // then close the action sheet.
          const s = actionSession();
          if (!s) return;
          setRenameTarget(s);
          setActionSession(null);
        }}
        onToggleArchive={handleToggleArchive}
        onDelete={handleDelete}
      />

      <RenameSheet
        open={renameTarget() !== null}
        initialTitle={renameTarget()?.title ?? ""}
        saving={saving()}
        onCancel={() => setRenameTarget(null)}
        onSave={handleRename}
      />
    </div>
  );
}
