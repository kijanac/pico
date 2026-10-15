# Waiting-state and continuity review

Initial review-only follow-up to [the loading-state audit](extension-feasibility-and-loading-audit.md#g--the-perfect-app-has-no-loading-states), using [The perfect app has no loading states](https://floriankiem.com/writing/the-perfect-app-has-no-loading-states).

The findings and source line references below record the pre-fix implementation. The six primary fixes were subsequently authorized and implemented; see [implementation follow-up](#implementation-follow-up).

The focus here is not decorative loaders. It is whether the app preserves work, respects newer intent, gives an immediate receipt for an action, and reports failure where the user can act on it.

## Method and scope

- Inspected fetching, mutation, draft, navigation, error, export, and authentication state ownership.
- Exercised six cases against the running build in fresh Chromium contexts at a 390 × 844 mobile-sized viewport.
- Used explicitly held responses to control completion order, typed simulated failures, and mocked mutation responses.
- Intercepted mutation/export requests before they reached the host. No messages were sent and no sessions, settings, credentials, or real exports were created/changed by these tests.
- This is browser/source verification, not real-iPhone PWA verification, a general visual critique, or a latency/CPU benchmark.

Temporary reproduction script: `/tmp/pico-browser/waiting-review.mjs`.

Machine results and screenshots: `/tmp/pico-browser/waiting-review/`.

## Summary

| Priority | Finding | Verification |
| --- | --- | --- |
| P1 | A late refresh overwrites a newer successful setting change | Browser response-order test + source |
| P1 | Unsent image attachments disappear when leaving/returning to a conversation | Browser navigation test + source |
| P1 | A delayed create response navigates away from the screen the user moved to | Browser held-response test + source |
| P2 | Rename failure is shown behind the still-open sheet, not inside it | Browser injected-failure test + source |
| P2 | Export has no pending receipt and permits duplicate requests | Browser held-export test + source |
| P2 | A failed tree fetch also displays a successful-empty-state claim | Browser injected-failure test + source |

All six behaviors were reproduced. The settings fixture used a synthetic boolean control; the create fixture returned existing-session metadata instead of creating an agent. These tests establish UI behavior under the supplied response ordering/failure, not production failure frequency.

## 1. P1 — refreshed data can undo a successful action

### Observed

1. Load a control with value `off`.
2. Open session settings; its background refresh captures the old value but is held.
3. Select `on`.
4. The optimistic UI selects `on`, and the mocked mutation successfully returns `on`.
5. Release the older refresh.
6. The UI changes back to `off`, with no mutation failure.

### Cause

`pico/src/features/chat/model/active-session.state.svelte.ts:28–48` versions reads against other reads. `set()` does not advance that version or otherwise invalidate reads started before a mutation.

`pico/src/features/chat/actions/SessionSettingsView.svelte:51–65` uses `set()` for optimistic updates, successful mutation results, and rollback. A still-current old read can overwrite any of them.

### Why it matters

Caching makes a screen faster, but its refresh can make the screen lie about a just-completed action. This is more important than removing the loading text.

### Recommended behavior

Give each resource/session a data or mutation generation. Reads initiated before a newer mutation must not overwrite it. Successful mutation responses are authoritative for that mutation. Define rollback ownership so a failed older action cannot undo newer intent either.

Keep cached controls visible and background refreshes coalesced, as recommended in the earlier audit; do not solve this by disabling all interaction until fetching finishes.

### Related source-only risk

The session list has a similar ordering concern: `session-list.state.svelte.ts` guards refreshes against newer refreshes, but rename/archive/delete success does not invalidate a refresh already in flight. An older list can potentially restore an old title or a removed row. This scenario was not browser-tested here; it belongs in the same mutation-ordering regression suite.

Evidence: `setting-after-successful-patch.png`, `setting-after-stale-refresh.png`.

## 2. P1 — draft continuity preserves text but loses images

### Observed

1. Type an unsent draft and paste a valid image.
2. The image tray contains one removable image.
3. Return to Sessions, then reopen the conversation.
4. The exact draft text returns; the image tray contains zero images.

### Cause

`pico/src/features/chat/components/InputBar.svelte:59–62` saves only text on destruction. Images belong to that component instance. `restoreDraft():133–137` restores text and explicitly clears images.

`pico/src/features/chat/model/chat-draft.ts` persists only a string.

### Why it matters

Moving between chats should not mean rebuilding a message. Recovering the text makes the loss of the attached screenshot particularly easy to miss.

### Recommended behavior

Own text and attachments as one session-scoped draft. Preserve them across ordinary route remounts; clear them only after transfer into a recoverable outbox, explicit removal/discard, or successful completion according to the chosen send semantics.

Treat survival of full PWA termination as a separate storage-policy decision. If durable image drafts are supported, use an appropriate media store with visible quota/failure handling rather than silently degrading to text-only storage.

### Related source-only risks

- `chat-log.state.svelte.ts:76–85` catches outbox-storage failure and retries persistence without images. A later reload can therefore recover a text-only outbox without explaining that attachments were dropped. Quota exhaustion was not simulated in this pass.
- Image picking/paste failures are logged to the console in `InputBar.svelte:284–304`, with no visible failure state. Valid-image paste was tested; failed decoding was not.

Evidence: `draft-with-image.png`, `draft-after-return.png`.

## 3. P1 — late creation takes over navigation

### Observed

1. Start Create session and hold its response.
2. Dismiss the sheet.
3. Open Settings; the route is `/settings`.
4. Release a mocked successful create response.
5. The app navigates to `/s/<returned-id>` even though the creation screen was left.

### Cause

`pico/src/features/sessions/SessionsScreen.svelte:29–35` navigates unconditionally when the async create resolves. Completion is not tied to the continued ownership of the creation flow or route.

### Why it matters

Static navigation is available while the operation waits, but a late callback then takes that freedom back. A slow connection makes this much more likely to surprise the user.

### Recommended behavior

If the user remains in the creation flow, open the new conversation. If the user deliberately leaves, allow creation to complete but update the list and expose a non-disruptive “created · open” receipt. Do not yank them away from their current screen.

Dismissing the sheet need not cancel server-side creation; that is a separate policy. The UI must distinguish continuing background work from cancellation. A route/flow generation should prevent stale callbacks from closing or navigating newer flows.

Evidence: `create-dismissed-on-settings.png`, `late-create-redirect.png`.

## 4. P2 — rename failure is hidden behind its modal

### Observed

A typed simulated rename failure leaves the rename sheet open with the draft intact. The sheet has no error message. The parent list contains the error panel, obscured by the sheet backdrop. The browser also reports an unhandled rejection.

### Cause

`SessionsScreen.svelte:40–44` awaits the mutation without handling the rejection locally. The mutation stores its issue on the shared list state. `RenameSheet.svelte` has no error prop/region.

### Why it matters

The visible interaction feels like Save did nothing. Keeping input is good, but recovery must appear alongside that input—not behind the blocking surface.

### Recommended behavior

Catch the failure in the rename flow and show it in the sheet. Keep the entered value and make retry available. Keep diagnostic details accessible without making the user close the sheet to discover whether anything happened.

For other row operations, provide an immediate pending receipt and catch rejected promises. Do not make destructive operations optimistically disappear unless the rollback/undo semantics are deliberately designed.

Evidence: `rename-failure.png`; the results JSON contains the corresponding unhandled error.

## 5. P2 — export disappears into the background without a receipt

### Observed

1. Select Export to HTML and hold its request.
2. The menu closes.
3. Reopen the menu while export is pending.
4. Export remains enabled; selecting it creates a second intercepted request.

### Cause

`SessionAgentActions.svelte:25–37` closes the sheet before awaiting export, but tracks no pending export state. `MenuView.svelte` cannot display/disable a pending export action.

### Why it matters

Closing immediately feels responsive, but no receipt makes the action feel lost. Repeating it is a reasonable user response, which creates duplicate work. On eventual failure, reopening a menu from an old callback can be disruptive too.

### Recommended behavior

Track export by session, show a small persistent “preparing export” receipt, and coalesce/disable duplicate requests. Navigation should remain usable. Deliver success/failure to the task's owner rather than reopening whichever menu is now on screen.

A ready “share/download” action may also be more reliable than invoking the share sheet after a long asynchronous fetch, but that needs separate real-iPhone testing. This pass did not test Safari share/download behavior or a real export.

Evidence: two intercepted export requests in `results.json`; `export-failure.png`.

## 6. P2 — failure is rendered as empty content

### Observed

When the tree request fails, the sheet displays both the request error and `no persisted tree entries yet`. There is no inline Retry action.

### Cause

`TreeView.svelte:58` interprets `(tree?.entries.length ?? 0) === 0` as empty once `loading` is false. That also includes the never-loaded/null failure case.

### Why it matters

“No entries” is a claim about successfully loaded data. It should not appear when the app has failed to obtain that data. The user must also back out/reopen the tree to retry.

### Recommended behavior

Distinguish unknown, loaded-empty, loaded-content, and failed states. On refresh failure retain known content. On first-load failure show the error and an inline Retry action, without the empty-state claim.

This is the same principle behind preserving a known empty session list during background refresh: empty is valid cached data, not a substitute for unknown.

Evidence: `tree-failure-claims-empty.png`.

## Additional source-only concerns

- **Auth-job continuity:** provider auth state is local to the mounted view. Leaving/reopening loses its job reference while the host operation may still exist. Polling every interval allows overlapping `refreshJob()` calls; there is no job/read generation to stop a late response from replacing newer submit/cancel state. Preserve non-secret task identity and serialize/version responses, not pasted credentials. No login was initiated or tested.
- **Directory navigation:** the earlier audit's enabled old-directory actions while another path loads remain relevant. A responsive screen must not let fast taps act on data from a different requested location.
- **Cached model/settings/stats across A → B → A:** keyed resources and in-flight deduplication from the earlier audit still matter. Mutation ordering should be fixed before adding more prefetching around them.

## What already deserves preserving

- Static navigation and route shells render before data completes.
- Cached non-empty session lists and recent conversation logs remain available while revalidating/reconnecting.
- Text drafts survive normal conversation navigation.
- Sends have an immediate outbox representation, recovery controls, and honest `not confirmed` wording rather than claiming every transport failure means the host rejected the message.
- The file sheet keeps cached content on refresh failure and distinguishes “couldn't refresh” from “couldn't open.”
- Extension answer submission keeps the prompt/input until the host acknowledges it and makes failed submission visible.

## Suggested implementation order, if requested

1. Fix stale-read/mutation ownership and async flow ownership. These protect truth and user intent.
2. Make drafts include attachments; remove silent loss during recovery.
3. Put rename errors/retry in their owning sheet and fix tree unknown-versus-empty rendering.
4. Give export and other long actions persistent pending receipts and duplicate suppression.
5. Then extend keyed caching/deduplication to tree, directories, providers, and session resources from the earlier audit.

These primary findings are frontend state/lifetime problems. None requires the Pi-extension redesign or a protocol change as a prerequisite. Durable media drafts, cross-view auth tasks, and robust pending-task recovery warrant explicit storage/lifetime decisions before implementation.

No application fixes were applied during the initial review. Existing file/PDF/streaming changes were preserved. Real iPhone keyboard, PWA suspension, native image picking, and share/download behavior remain separate verification work.

## Implementation follow-up

The six primary fixes are implemented:

- Shared session resources use an Effect-based helper with Deferred read coalescing, mutation revisions, owned rollback, and completion cleanup. Initial reads may begin before parent activation; only commits are gated against active identity. Reads queued behind a mutation do not restart for a session that was left.
- Session-list reads are guarded against intervening mutations. Successfully loaded empty lists remain visible during refresh and refresh failure.
- Draft text and images are stored together in a parsed, versioned local-storage record. Existing text-only drafts migrate on save. Navigation/destruction, pagehide, and hidden-page transitions save the snapshot; storage/quota failure keeps the whole draft in memory and displays a warning rather than claiming reload durability. Draft storage is released before the synchronous outbox handoff to avoid temporarily storing two image copies; preparation failure restores the draft.
- Delayed creation opens the conversation only while its original flow remains active. Otherwise, a retained list receipt offers an explicit Open action. Dismissal/navigation invalidates old create/rename callbacks.
- Rename failure is caught and rendered inside its sheet with the input preserved for retry. Other row actions no longer leak rejected promises; delete failures are also shown inside the dialog.
- Export preparation is an Effect-owned task independent of route lifetime. One preparation runs at a time; a persistent receipt shows the originating conversation and preparing/ready/failed state. Ready exports require an explicit share/download tap, so native sharing is initiated from a fresh user action. Failure never reopens an unrelated menu. Download URLs live until their task is replaced/dismissed, not an arbitrary timer.
- Tree loading/error/empty states are distinct, with an inline retry. Known data is retained during refresh failure, and callbacks are guarded against view/session changes.

Settings and tree fetching/mutation behavior is moved into feature composables; presentation remains prop/derived-state driven. No host/protocol changes or Pi-extension implementation were needed for these fixes.

Unit coverage is in `async-resource.test.ts`, `chat-draft.test.ts`, and `export-task.test.ts`: overlapping reads, stale refreshes, rollback ownership, session changes, interrupted Effects, persistence/migration/quota failure, and export coalescing/retry.

Verification completed against the production build at loopback port 7777:

- Workspace build/type checks passed; the final frontend build reports 0 Svelte errors and 0 warnings.
- All 17 test files / 105 tests passed, including 29 new regression tests.
- All 10 controlled browser cases passed: the original six, automatic creation while staying in the flow, quota-warning/memory recovery, stale list responses after rename, and cached-empty list refresh failure. No unhandled browser errors were recorded.
- Image drafts survived ordinary navigation and full reload; explicit image removal also survived reload.
- Export status survived navigation to Settings; failure did not reopen a menu; retry produced a mocked ready file that downloaded successfully on explicit tap.
- Mutation/send/export requests were intercepted before reaching the host. No real session/settings mutation, message send, login, or export generation occurred.

Evidence: `/tmp/pico-browser/waiting-fixes.mjs` and `/tmp/pico-browser/waiting-fixes-production/results.json` plus screenshots in that directory. The temporary Vite verification unit was stopped. The existing host serves the rebuilt web assets; no production service restart was needed.

These are desktop Chromium checks at a mobile-sized viewport, not native iPhone verification. Keyboard/header behavior, PWA suspension/termination, native image picking, and Safari share/download remain device-specific follow-ups.

The subsequent [file browser/image work](files-and-images.md) adds owned/cached directory reads for that browsing surface and fixes outbox quota handling: full messages and attachments are retained in a copied in-memory fallback with an explicit warning, rather than retried as text-only persistence. Provider auth-job continuity, ownership in the separate working-directory picker, and general keyed tree/provider caches remain follow-ups. Neither draft nor outbox changes claim full PWA-termination durability when local storage cannot save the work.
