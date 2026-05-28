import { createEffect, on, onCleanup, Show, type JSX } from "solid-js";
import { useParams, A } from "@solidjs/router";
import EdgeSwipeBack from "~/components/EdgeSwipeBack";
import Header from "~/components/Header";
import StatusDot from "~/components/StatusDot";
import RetryBanner from "~/components/chat/RetryBanner";
import MessageList from "~/components/chat/MessageList";
import InputBar from "~/components/chat/InputBar";
import SessionAgentActions from "~/components/chat/SessionAgentActions";
import {
  activeStatus,
  applyWireEvent,
  resetActiveLog,
  useSession,
  setSessions,
} from "~/stores/sessions";
import {
  connState,
  setConnState,
  setActiveSend,
} from "~/stores/connection";
import { connectStream } from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";
import { resumeTick } from "~/lib/lifecycle";
import { formatCost, formatTokens, shortPath } from "~/lib/format";
import type { WireEvent } from "@pi-mobile/protocol";

export default function Session(): JSX.Element {
  const params = useParams<{ id: string }>();
  const session = useSession(() => params.id);

  // Re-bind whenever the URL param changes (the router reuses the component).
  createEffect(
    on(
      () => params.id,
      (id) => {
        resetActiveLog();
        setConnState("connecting");

        let closed = false;
        let handle: { reconnect: () => void; close: () => void } | null = null;

        const start = async () => {
          const baseUrl = await getBridgeUrl();
          if (closed) return;

          const stream = connectStream(baseUrl, id, 0, {
            onOpen: () => setConnState("connected"),
            onClose: (_code, _reason, terminal) => {
              if (terminal) {
                setConnState("gone");
                setActiveSend(null);
                setSessions((list) => list.filter((s) => s.id !== id));
              } else {
                setConnState("reconnecting");
              }
            },
            onError: () => setConnState("error"),
            onEvent: (e: WireEvent) => {
              if (e.t === "hello") {
                setSessions((list) => {
                  const exists = list.some((s) => s.id === e.session.id);
                  return exists
                    ? list.map((s) =>
                        s.id === e.session.id ? e.session : s,
                      )
                    : [e.session, ...list];
                });
              }
              if (e.t === "cost") {
                setSessions((list) =>
                  list.map((s) =>
                    s.id === id
                      ? {
                          ...s,
                          tokens: { in: e.tokensIn, out: e.tokensOut },
                          costUsd: e.costUsd,
                        }
                      : s,
                  ),
                );
              }
              applyWireEvent(e);
            },
          });

          handle = stream;
          setActiveSend(() => stream.send);
        };

        void start();

        createEffect(
          on(
            resumeTick,
            () => {
              if (closed || !handle) return;
              handle.reconnect();
            },
            { defer: true },
          ),
        );

        onCleanup(() => {
          closed = true;
          setActiveSend(null);
          setConnState("offline");
          handle?.close();
        });
      },
    ),
  );

  return (
    <EdgeSwipeBack href="/">
      <div class="flex h-dvh min-h-0 flex-col overflow-hidden">
        <Header
          back="/"
          trailing={<SessionAgentActions sessionId={params.id} />}
        >
          <Show when={session()}>
            {(s) => (
              <div class="flex min-w-0 items-center gap-2">
                <StatusDot status={activeStatus()} />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-[13px] font-medium leading-tight">
                    {s().title}
                  </div>
                  <div class="truncate text-[10px] text-[color:var(--color-fg-faint)]">
                    {shortPath(s().cwd, 2)}
                    {s().branch ? ` · ${s().branch}` : ""}
                  </div>
                </div>
              </div>
            )}
          </Show>
        </Header>

        <Show when={session()}>
          {(s) => (
            <div class="hairline-b flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">
              <span>
                in{" "}
                <span class="text-[color:var(--color-fg-muted)] tabular-nums">
                  {formatTokens(s().tokens.in)}
                </span>
              </span>
              <span>
                out{" "}
                <span class="text-[color:var(--color-fg-muted)] tabular-nums">
                  {formatTokens(s().tokens.out)}
                </span>
              </span>
              <span class="ml-auto text-[color:var(--color-fg-muted)] tabular-nums">
                {formatCost(s().costUsd)}
              </span>
            </div>
          )}
        </Show>

        <RetryBanner />
        <Show
          when={connState() !== "gone"}
          fallback={<SessionGonePane />}
        >
          <MessageList />
          <InputBar />
        </Show>
      </div>
    </EdgeSwipeBack>
  );
}

/**
 * Rendered in place of MessageList/InputBar when the server has told
 * us this session no longer exists (WS close code 4004). The user's
 * scrollback isn't useful here — it'd just be empty replay output —
 * so we explain and offer a route back to the list. The list itself
 * has already been pruned (see Session.tsx onClose) so navigating
 * away won't show the stale entry.
 */
function SessionGonePane(): JSX.Element {
  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div class="text-[13px] font-medium">session no longer available</div>
      <div class="max-w-[28ch] text-[11px] text-[color:var(--color-fg-muted)]">
        the bridge can't find this session — its on-disk file may have
        been removed, or the session was started in ephemeral mode.
      </div>
      <A
        href="/"
        class="mt-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-strong)] px-3 py-1.5 text-[12px] active:bg-[color:var(--color-surface)]"
      >
        back to sessions
      </A>
    </div>
  );
}
