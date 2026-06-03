# Performance optimization opportunities

This note captures the biggest principled performance opportunities observed in the pi-mobile workspace, with emphasis on scenarios where each optimization is likely to matter most.

## 1. ✅ Make the bridge session log/reconnect path incremental

**Status:** shipped in `v0.9.2`.

**Likely high-impact scenarios:** long-running sessions, large tool outputs, many read/write/edit events, flaky mobile connectivity, repeated background/foreground reconnects over cellular or Tailscale.

Completed:

- Removed routine full `log_reset` snapshots from normal `message_end` handling.
- `SessionManager.subscribe(...)` now uses the requested cursor and replays `store.loadEventsAfter(sessionId, cursor)` for valid cursors.
- `log_reset` remains available for true reset/fallback cases such as branch navigation or invalid/ahead cursors.
- Assistant usage shape now matches pi-ai's usage shape directly, avoiding bridge-side translation.
- Added a one-shot/idempotent SQLite migration for old message-usage payloads.
- Added smoke coverage that verifies valid cursor replay uses journaled events instead of `log_reset`.

Remaining follow-up ideas:

- Add snapshot/checkpoint compaction: keep a latest snapshot plus incremental events after it, then prune old redundant snapshots.
- Avoid storing very large tool results repeatedly; store large blobs once and reference them when appropriate.

## 2. Batch streaming assistant deltas before UI updates

**Likely high-impact scenarios:** fast model output, long assistant answers, mobile devices rendering near the bottom of the chat.

Assistant deltas are forwarded live and applied one chunk at a time. Each chunk mutates the active message, bumps chat activity, and can trigger scroll/markdown work. The bridge already coalesces deltas before persistence, but the live UI path still receives delta-frequency updates.

Principled direction:

- Coalesce assistant deltas per message on the bridge or client.
- Flush at animation-frame cadence or every ~33–100 ms.
- Flush immediately on `assistant_end`.
- Keep sequence/cursor semantics explicit when batching.
- Scroll at most once per batch/frame.

## 3. Virtualize and lazily render chat history

**Likely high-impact scenarios:** sessions with hundreds or thousands of entries, large bash/read/write output, large diffs, code-heavy agent sessions.

The current message list renders the full active log. That is simple and works well for short sessions, but coding-agent transcripts can become large quickly.

Principled direction:

- Add chat virtualization/windowing.
- Keep recent messages mounted and lazily mount older messages near the viewport.
- Collapse large tool results by default.
- Render only bounded previews for large outputs, with full content on demand.
- Avoid recomputing old markdown/tool/diff rendering when only the streaming assistant message changes.

## 4. Move highlighting and diff work off the critical path

**Likely high-impact scenarios:** large edits, large file reads/writes, code-heavy markdown responses.

Shiki language chunks are dynamically loaded, which is good, but highlighting and diff work still happens on the client main thread. Large diffs and full-file highlighting can create visible jank.

Principled direction:

- Highlight only when content is expanded and visible.
- Add size thresholds; use plain escaped text or previews for very large blocks.
- Cache highlight results by language and content hash.
- Consider a Web Worker for Shiki and diff computation.
- For diffs, highlight only rendered hunk lines rather than entire old/new files.

## 5. Reduce cold-start bundle and production artifacts

**Likely high-impact scenarios:** app launch on older phones, first install/sync, slow networks, native bundle size constraints.

The app imports route trees eagerly, and production builds currently include sourcemaps. The built app also contains many dynamic highlighter chunks.

Principled direction:

- Lazy-load route components.
- Lazy-load heavy sheets/actions/settings/onboarding flows.
- Make production sourcemaps conditional or disable them for release builds.
- Split protocol runtime validation from type-only exports where practical.
- Keep highlighter code out of the initial path unless needed.

## 6. Add bridge idle eviction and backpressure

**Status:** partial. A coarse idle-session eviction pass is implemented locally: when a managed session has no subscribers, no pending sends, is not compacting, and is idle/error for 15 minutes, the bridge closes the `PiSession` and removes it from the in-memory session map. Reopening the session resumes it from disk.

**Likely high-impact scenarios:** bridge running for days or weeks, many historical sessions, slow or unstable clients, multiple reconnecting mobile devices.

Managed sessions are cached in memory once created or resumed, and several queues/pubsubs are unbounded. WebSocket sends do not currently account for client-side backpressure.

Remaining direction:

- Bound queues and define overflow behavior.
- Monitor WebSocket `bufferedAmount`; batch, pause, or disconnect slow clients.
- Batch SQLite writes after the full-snapshot issue is addressed.
- Make eviction tunable/observable if needed.

## Expected priority order

1. ✅ Bridge journal/reconnect protocol — shipped in `v0.9.2`.
2. Mobile chat virtualization plus large-result collapsing.
3. Streaming delta batching.
4. Lazy/off-thread highlighting and diffing.
5. Cold-start bundle/code splitting/sourcemap cleanup.
6. Bridge idle eviction/backpressure.
