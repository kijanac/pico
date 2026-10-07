# Sync redesign: pi entries plus a live mirror, no journal

Status: built on `devbox`, not yet committed or deployed (2026-10-07). The
wire protocol and host notes below describe what was built.

## Why

The host keeps a second, numbered copy of everything it streams to the phone in
SQLite (the `events` table), so the phone can catch up after a disconnect. pi
already saves the conversation in its own session file. The journal therefore:

- writes every streamed chunk to disk a second time;
- keeps its duplicate check (client message ids) only in memory, so a send
  retried just after a host restart can reach the agent twice;
- loses queued messages on a restart (pi's queue is memory-only) without telling
  the phone.

A fresh Opus 5.5 and a fresh Fable 5.1 each designed phone sync from first
principles without seeing this code, and converged on the design below. Where
they differed, Opus's version is used (reasons inline).

## Decisions

1. Stay on the pi coding agent (not pi-durable): the phone and `pi` in tmux keep
   sharing `~/.pi/agent` sessions.
2. The phone's catch-up bookmark is the **id of the last pi entry it has**. pi's
   own RPC uses the same cursor (`docs/rpc-commands.md` in pi-coding-agent). No
   Pico sequence numbers, no journal.
3. What pi never saves (the reply being streamed, running tools' output, the
   queue, run status) lives only in host memory, as a **mirror built from the
   events the host has actually forwarded**. Not `state.streamingMessage`: pi
   updates its state before notifying listeners, so a snapshot of it can include
   text not yet forwarded, which the next delta would then repeat.
4. **Nothing is written into pi's files.** No marker entries.
5. **Tool output is sent in full**, no clipping. pi already caps tool results
   (bash keeps a 50 KB / 2,000-line tail).
6. Duplicate sends are caught by client message ids held in host memory. After a
   restart, a retried send carries the bookmark the phone had when it first sent
   it; the host treats it as delivered if pi's file has a user message with the
   same text after that bookmark.
7. SQLite stays, trimmed to the `sessions` table (Pico's session list: which
   sessions it shows, archived, cached title/cwd/status/usage). The `events` and
   `session_prune` tables go.
8. On SIGTERM (deploys, `systemctl stop`) the host aborts running turns first, so
   pi saves the partial reply and tool results.
9. After a restart nothing resumes on its own. The phone shows the saved state; a
   turn cut short shows as interrupted.

### Defaults for questions still open

- Messages queued when the host restarted (pi's queue is lost): the phone shows
  them as **not delivered, with a "send again" action**, rather than re-sending
  automatically. A lost steer re-sent to an idle session would start a new run.
- Deploy mid-turn: **abort immediately** (pi saves the partial reply).
- Branch navigation from the phone stays in scope; it resets the phone's view.

## Design

### Where things live

| Where | What | Bound |
|---|---|---|
| pi's JSONL | All finished entries (messages, tool results, compaction, model changes, branches) | pi's own |
| Host, per open session | pi's `AgentSession`; the live mirror `{run, msg, tools, queue}`; recent client message ids → state | one partial reply, running tools' output, ~100 ids |
| Host registry | `Map<sessionId, Promise<OpenSession>>`, one `AgentSession` per file even when opens race; idle sessions with no viewers close after 10–15 min | active sessions only |
| Host, per socket | outgoing buffer; a socket over 2,048 messages behind is dropped and the phone catches up from its bookmark | 2,048 messages |
| SQLite | `sessions` table only | tens of rows |
| Phone memory | newest part of the active branch (~300 entries), bookmark, leaf, live mirror | ~300 entries; older pages refetched on scroll |
| Phone storage | outbox of unconfirmed sends (localStorage) | tiny |

### Host

- **Pump.** pi notifies `message_end` *before* it writes the entry
  (`agent-session.js`, `_emit` then `appendMessage`), and `entry_appended` fires
  only for special cases (cache warmer, virtual-model state, boundary drafts), not
  for ordinary messages. So after every pi event and every host command, a
  microtask compares `sessionManager.getEntryCount()` with what was last published
  and publishes anything new. Independent of pi's event order; also picks up
  compaction, model changes and branch summaries.
- **Live mirror and shared reducer.** One pure reducer applies live events to the
  mirror. The host uses it for its mirror, the phone for its screen state. A new
  entry ends the matching live item (an assistant entry clears the streaming
  message; a tool result clears its tool).
- **Subscribe in one synchronous step:** flush pending deltas, run the pump,
  build `sync` (entries after the phone's bookmark, or a reset to the newest page,
  plus the live mirror), send it, then add the socket to the broadcast set. No
  `await` in between, so no event can fall between snapshot and live stream.
- **Send.** `sessions.send {cid, text, mode, images?, base, retry}` over
  `POST /rpc` is safe to repeat. The host records `cid` before its first `await` (racing retries can't
  both pass), serializes sends per session only until pi reports the disposition
  (`prompt(…, { streamingBehavior, preflightResult })`: started / queued /
  handled), and links `cid` to the user entry by the text pi queued (captured
  from the `queue_update` emitted during the call, as pi itself matches queued
  items), else to the send that started the run. `base` drives the
  after-restart check (decision 6), which runs only on retries (`retry`), so a
  new message that repeats an earlier one isn't mistaken for a duplicate.
- **Compaction.** pi refuses `prompt()` during a manual compaction, and its TUI
  holds input during any compaction, so the host holds sends while compacting
  (`held`) and hands them to pi in order when it ends.
- **Shutdown.** On SIGTERM: refuse new sends, await `abort()` on running
  sessions (10 s cap), then close them; `NodeRuntime.runMain` runs the
  finalizers. Streams end when the server closes and the phone reconnects; no
  special close codes.

### Wire protocol

Host → phone: the stream `session.live {id, head, cids}` over `GET /ws`
(@effect/rpc, which already pings every 10 s, so there is no heartbeat):

- `sync {reset, leaf, entries, more?, live, session, sends}`: entries after
  `head` when it is on the current branch within 400 entries, else `reset` with
  the newest page (about 100 entries, starting at a user message) and `more`
  (oldest id sent). `sends` reports the asked-about `cids` the host knows.
  Sent again with `reset` to every socket when the leaf moves to another branch.
- `entries {leaf, entries}` from the pump; user entries carry their `cid`.
  Entries are pi's own (`tools: [{id, name, args}]` passed through); the
  phone's reducer narrows tool args.
- `msg {at}` (a reply started), `d {s}` (reply text, ≤ every 50 ms).
- `call {id, name, drop?, from, s}`: a tool call the model is still writing,
  its arguments (as pi parsed them, serialized to JSON) changed like `out`, ≤
  every 250 ms. The phone shows it as a pending tool row, as pi's TUI does; an
  edit's diff appears once the arguments are complete.
- `out {id, drop?, from, s, details?}`: a running tool's output, ≤ every
  250 ms: keep characters `drop` to `from` of the old output, then append `s`.
  `drop` covers bash keeping only its last 50 KB, so only new lines are sent.
- `run {running, compacting, retry?}` from `agent_start`, `agent_settled`,
  `compaction_*`, `auto_retry_*`.
- `queue {queue: [{text, mode, cid?}]}`, held sends first, then pi's queue.
- `ui {request}`, `ui_done {id}` (extension dialogs; open ones are in the
  mirror), `send {cid, state, entry?, error?}`, `meta {session}`.

HTTP (`POST /rpc`): `sessions.send`, `sessions.history {before}`,
`sessions.interrupt`, `sessions.uiResponse`, and `sessions.clearQueue`, which
returns what was queued so the phone can put it in the composer (pi's dequeue).

### Phone

- Entry window (~300 entries of the active branch), bookmark and leaf, the live
  mirror via the shared reducer.
- Outbox in localStorage: a message stays optimistic until an entry or queue
  item with its `cid` arrives; retries reuse the `cid` and `base`.
- If the app was hidden for more than 3 s, drop the socket and reconnect: iOS
  leaves dead sockets that still look open.
- Scrolling up fetches older pages over HTTP; far-off entries are dropped.

### SQLite

Keep `sessions` with field-wise `UPDATE`s (already in place). Drop `events` and
`session_prune` (`DROP TABLE IF EXISTS` at startup).

## Known tradeoffs

- **A half-written reply is lost on a hard crash** (SIGKILL, out of memory,
  power). pi saves only finished messages; graceful restarts abort first and keep
  it. Display only: the agent never sees that partial text in either design.
- **Notices Pico invents itself** (the "no model provider signed in" message,
  retry timing) show live but not after reopening. Failed attempts themselves
  stay: pi saves assistant messages with `stopReason: "error"`.
- **No record of exactly what the phone was sent** (the journal doubled as one).
  Logs can cover it.
- **Linking a queued send to its entry relies on pi's internal event order**
  (`queue_update` before the delivered message's `message_start`). Needs a
  regression test on every pi upgrade.
- **Queued messages lost to a restart** need the user's "send again" (pi's queue
  is memory-only).

## Verified

1. pi 1.0.4 throws on `prompt()` during a manual compaction, and its TUI holds
   messages during any compaction, so Pico still holds them (see Host).
2. Not yet checked: whether Tailscale Serve passes `permessage-deflate` through.
3. Linking doesn't depend on `queue_update` / `message_start` order: it uses the
   text pi queued. Checked against real pi (with a local fake model) for a
   started prompt, a steer and a follow-up.

## Steps

1. **Protocol:** new message types and the shared reducer (entries + live
   mirror), with unit tests.
2. **Host core:** registry, pump, mirror, subscribe; remove the journal paths in
   `session.ts` and the event methods in `store.ts`.
3. **Host send:** HTTP send with `cid` dedupe, disposition, linking, the
   after-restart check; queue from pi's `queue_update`.
4. **Host shutdown:** abort on SIGTERM, close codes, interrupted state.
5. **SQLite:** drop the journal tables.
6. **Phone:** new log state (window + mirror), outbox, reconnect policy, history
   paging; delete the cursor/replay code.
7. **Tests:**
   - reducer and dedupe unit tests;
   - the smoke test rewritten for the new protocol;
   - kill tests: SIGTERM and SIGKILL during a started prompt and during a queued
     steer, then assert user entries in pi's file == sends;
   - the scenario walkthroughs below as browser checks.
8. **Measure** on the devbox over Tailscale:
   - wake cost (bytes and time to rendered) after 1 minute and 1 hour away;
     target under 50 KB and 500 ms;
   - host RSS with 5 sessions open;
   - streaming bytes/s with and without deflate.

### Scenarios to walk through

1. Wake mid-reply while a tool streams output.
2. Host restart mid-turn with the phone open.
3. A send times out but the host received it.
4. Two devices on one session.
5. Cold open of a 3,000-message session.
6. Phone suspended for an hour.

## Results (local, before deploying)

Checked:
- Unit tests for the reducer and live mirror, and the rewritten smoke test
  (sync, live turn, steer linked by cid, repeated cid, catch-up, history,
  after-restart check).
- Kill tests against real pi with a local fake model: SIGTERM and SIGKILL during
  a started prompt and during a queued steer. Every send ended up in pi's file
  exactly once; SIGTERM kept the partial tool output.
- Browser checks against the mock host: scenarios 1, 4 and 5, plus reconnect
  mid-reply (no duplicated text), a steer shown once from send to saved, and
  moving the queue to the composer. Scenarios 2, 3 and 6 are covered by the
  kill tests and the catch-up path.

Measured on the Mac against the previous commit, same workload (real pi, fake
model, 3 turns with a 6 s bash tool and a 4 s reply):

| | Before | After |
|---|---|---|
| Bytes to the phone during the turns | 43.5 KB | 28.1 KB (−35%) |
| Catch-up after missing a turn | 6.4 KB | 2.0 KB (−69%) |
| Cold open | 6.7 KB | 6.3 KB |
| Catch-up when current | 432 B | 506 B |
| Host CPU for the turns | 1.64 s | 1.38 s |
| SQLite after 4 turns (db + WAL) | 2.08 MB | 0.16 MB |
| Host RSS | 134 MB | 133 MB |

Not yet measured on the devbox over Tailscale, or with deflate.

### Queue editing

pi has no per-item queue API (requested upstream in #9174, not taken up), so
Pico follows pi's TUI: tapping a queued message moves the whole queue to the
composer. Upstream #9886: `clearQueue()` drops messages extensions queued with
`sendMessage`; switch to `clearQueue({ userMessagesOnly: true })` when it lands.

## Size

Source lines, before → after: host 3,521 → 2,933; protocol 951 → 984; chat UI
3,763 → 3,600.
