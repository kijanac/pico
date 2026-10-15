# App follow-ups

Requested during the file-viewer and streaming-display fixes.

| Item | Request | Current boundary |
| --- | --- | --- |
| A | Simple, clean file-directory browser | Implemented: direct header access, one stable-height folder/file panel, canonical workspace/parent navigation, local filter, hidden toggle, owned listing reads, and cached revisits. Deployment/verification tracked in [files and images](files-and-images.md). |
| B | Rename a session | Available from session-list row actions. Make it easier to discover or offer it inside session info. |
| C | View images sent by the agent, including screenshots | Implemented: authenticated raster-file delivery, fit/zoom preview, clickable generic Pi tool images, and explicit preview links for local Markdown images. No guessed screenshot paths. See [files and images](files-and-images.md). |
| D | PWA notifications when it is the user's turn | Separate Web Push work: service worker, opt-in permission, subscriptions, host delivery, and explicit rules for completed turns versus extension input requests. Verify on an installed iPhone PWA. |
| E | Subprocess/sub-agent viewing | Read-only investigation complete; no activity UI implemented. Existing events support a running-tools view, but independent background jobs/child agents need a cooperating lifecycle contract. See [verified findings and remaining decision](activity-view-investigation.md). |
| F | Reconceive Pico as a Pi extension using Pi as its canonical backend | Pico and the TUI should share one live runtime, not separately resume the same file. Planning only with unmodified Pi: map supported controls, native process ownership, and UI gaps before building. See [deeper design](pi-native-extension-design.md). |
| G | Apply “The perfect app has no loading states” | File-sheet improvements shipped; six waiting/continuity fixes implemented: mutation-safe reads, image drafts, owned navigation, inline errors/retry, and export receipts. Known-empty list revisits also stay usable. The file browser now owns/caches its directory reads, and whole-message outbox quota handling no longer strips images. General tree/provider caching and the separate working-directory picker's ownership remain follow-ups. See [loading audit](extension-feasibility-and-loading-audit.md#g--the-perfect-app-has-no-loading-states) and [waiting-state review](waiting-state-review.md). |
| H | Copy an agent response | A copy action exists on final answers. Check discoverability and whether intermediate responses should have it too. |
| I | Select and copy part of an answer, tool result, or user message | Verify native text selection on the actual iPhone PWA, including gesture interference and clipboard behavior. |
| J | Open files from read/edit tools in a whole-file sheet with highlighting and diff | Implemented: current read/write links, captured full-file historical edits with inline additions/removals, separate current-file navigation, and honest uncaptured-history fallback. Capture is live for supported host edits after the coordinated rollout; older history remains uncaptured. See [snapshot provenance, limits, and verification](files-and-images.md#whole-file-edit-review). |

## Loading-state principles applied in this change

Source: [Florian Kiem, “The perfect app has no loading states”](https://floriankiem.com/writing/the-perfect-app-has-no-loading-states).

- Render file-sheet navigation and PDF controls before document data arrives.
- Load PDF.js only when a PDF is opened; do not delay ordinary chat or Markdown for PDF assets.
- Use PDF.js's visible-page rendering rather than rendering every page before showing the document.
- Keep the current file and two recently opened predecessors in an in-memory cache, so short back-navigation does not blank the sheet. Revalidate without hiding cached content.
- Keep failures explicit. Do not disguise unavailable files, unavailable networks, or first-use decoding as instant success.
- Do not add decorative spinners.

The three-file cache is a product choice for short document-navigation trails. Each text entry remains subject to the host's 1 MB text-display limit. PDF cache entries contain metadata, not PDF bytes; sensitive file responses are not persistently cached by the browser.

## Header controls and session-list motion — implemented

The conversation header orders its direct actions as tree, files, session info, session settings, then context. The rightmost context ring opens the existing compaction sheet and replaces the composer's percentage button. It uses current SDK context usage, not lifetime session tokens; unknown usage is visibly distinct from zero. The sheet shows the percentage and used/limit token counts when known. Compaction invalidates the ring until fresh usage is available.

Compaction is explicitly labeled **compact now** while idle, **stop & compact** while working, and disabled as **compacting…** during compaction. There is no separate busy-state paragraph. This corrects the earlier idle-only Pico restriction: installed Pi1.0.4 dispatches `/compact` before the TUI's streaming queue, aborts the active operation, waits for it to settle, and then compacts. Manual compaction does not automatically resume the interrupted turn. Source: `interactive-mode.js:2635` and `agent-session.js:2164` under the installed Pi package.

All header actions retain 44px targets. At 320px, all five actions stay together in the same order on a second header row, rather than hiding info or collapsing the title. The composer model button fits its text, truncating only when space is constrained; thinking sits immediately beside it, with unused space after the pair. The existing native keyboard/focus mechanism is retained, including for the marked compaction instructions editor.

Actual session-list reordering uses 180ms quint-out FLIP on keyed outer row wrappers. Metadata updates reuse the same ordered-ID array, so they neither start nor restart spatial animation. Warm refreshes retain the current list until fresh data arrives instead of briefly applying older stored ordering; equal timestamps use a deterministic ID tie-breaker. The swipe surface keeps its own transform and identity. Reduced motion applies the new order without spatial animation; there is no stagger or entrance animation.

The compaction submission still uses the existing close-on-start/error-to-composer flow; this is not a new route-independent compaction receipt or complete pending-request redesign.

## Composer controls and provider placement — live

The composer shows the model followed immediately by its current thinking level. Model width is intrinsic, not a fixed character cap or a stretched button. Thinking opens the actual supported levels and disappears when there is no alternative level. Both controls are removed from session settings; cost remains in session info rather than consuming composer space. The existing owned settings update/rollback path is retained.

Providers lives in app Settings, with **manage providers** in the model-picker header. The shortcut swaps the same fixed-height sheet rather than opening another modal. Returning preserves the model search and draft and refreshes available models. An unfinished provider form/job remains mounted during this within-sheet navigation; this is not route-independent authentication resumption. Credentials are not written to Pico's browser storage. Provider text fields use the existing native keyboard markers, and a failed provider read does not claim that no providers are configured.

Conversation tree opens directly from the header, without an overflow menu. **export HTML** lives in Session info and retains the existing route-independent export preparation/receipt, explicit delivery, retry, and duplicate-preparation guard. The overflow menu and its menu/back navigation state were removed.

Composer actions use one `ComposerActionButton.svelte` policy: 36px square visuals centered in 44px reserved slots, with enlarged touch hit regions. Desktop visual gaps are 12px; the fully occupied 320px row uses 8px gaps while retaining non-overlapping 44px touch areas. The footer remains 42px and the single-line composer 87px in the controlled fixture. Stop, send, queue, and attachment buttons share the same dimensions and corner radius. In short model panels, the search header scrolls with the results instead of pinning every result out of reach; the 12rem container breakpoint accommodates the search controls, padding and a usable first result. The provider shortcut adds no footer row.

Svelte check reported zero errors/warnings; 30 test files / 223 tests and 65 controlled browser cases passed. Coverage includes short/long names, 320px busy/queued layouts, unsupported thinking, optimistic changes and rollback, cross-session ownership, provider errors and mocked key/subscription flows, model-list refresh, preserved draft/search, actual model selection with a landscape keyboard, and existing file/image/keyboard/continuity behavior. Authentication, model changes and other test mutations were intercepted; no production session mutation occurred during verification.

The frontend is live, verified at 2026-10-15T14:47:26Z in `/tmp/pico-composer-deployment.json`. The host PID was unchanged, old hashed assets were retained, and review services were stopped. Stage: `/tmp/pico-composer-dist`. Evidence: `/tmp/pico-browser/composer-controls-built/summary.json`, its screenshots/results, and the `*-after-composer/` directories. Desktop simulations do not replace native iPhone confirmation.

## Controls and file-reader cleanup — live

The direct tree/export placement, Pi-aligned compaction action, square composer controls, and scoped reader scrolling are live, verified 2026-10-15T16:05:26Z in `/tmp/pico-controls-reader-deployment.json`. Publication retained old assets and switched the index last; host PID3688834 was unchanged. The live entry assets match the tested stage, and RPC private/no-store, missing-identity rejection, cross-origin rejection, and `fs.change` were verified without production session mutations.

Final checks: Svelte zero errors/warnings, 30 files / 223 tests, production build, whitespace checks, and 99 controlled browser cases (89 against the production bundle, 10 isolated-dev continuity cases). Coverage includes fine-pointer desktop/light and dark themes, 320/390px and tablet controls, click/hold send behavior, direct tree jumps and failure/retry, export receipts, explicit busy compaction and failure, native Chromium touch table panning, keyboard/wheel file scrolling, and existing provider/model/keyboard/image/large-file behavior. Browser touch input is not native iPhone proof.

Evidence: `/tmp/pico-browser/controls-reader/summary.json`, its screenshots/results, `/tmp/pico-browser/composer-action-layout-before/` and `composer-action-layout-after/`, and the `*-after-reader/` directories. Stage: `/tmp/pico-controls-reader-dist`, a symlink to `/home/kijana/.cache/pico-review/controls-reader-dist`. Temporary-directory quota required cache-backed staging and `TMPDIR=/home/kijana/.cache/pico-review/tmp` for the final unit-test rerun, not product changes. Review services are stopped. The previous `/tmp/pico-composer-dist` stage was byte-compared, moved to `/home/kijana/.cache/pico-review/pico-composer-dist`, and retained through a symlink at its original path to free temporary-directory quota without losing evidence.

## Session info and header clarity — live

Session info uses a flat definition list for workspace, cost, messages, and tool calls. A closed native **details** disclosure retains session ID/file, individual message/tool-result counts, input/output/total tokens, cache reads/writes, and current context. Full paths wrap without horizontal sheet overflow. Zero is still a valid value; unavailable context and unsaved session files are explicit. Loading and refresh failures keep their existing resource behavior; errors are announced, and cached information remains usable. **export HTML** stays outside the disclosure and uses the same owned task/receipt.

The header order is tree → files → info → settings → context. Routine cwd/connected subtitles are removed; connecting, reconnecting, offline, and gone labels remain. Connected titles can use two lines; connection warnings use the second line instead. The title region reserves 44px height so these states do not move the transcript. At 320px, the complete action group uses the existing second-row policy.

Header and composer utility glyphs use 20px Lucide inline SVGs, up from 16px (14px for Home). Their shared default two-unit stroke scales with the glyph; they are not raster assets. Header touch targets, 36px composer squares/44px reserved footprints, context ring, and simple stop/send glyphs are unchanged. This improves optical size, not an established native rendering defect; actual iPhone appearance remains a device check.

Verified live at 2026-10-15T17:30:38Z in `/tmp/pico-info-header-deployment.json`: tested index/entry bytes, private/no-store RPC, identity/origin protection, and unchanged host PID3688834. Publication preserved old assets and switched the index last; no restart or production session mutation. Checks passed: Svelte zero errors/warnings, 30 files / 223 unit tests, production build, whitespace checks, and 120 browser cases (108 production-bundle, 12 isolated-dev). New coverage includes 320/375/390/768/1280px, 1×/2×/3× density, keyboard disclosure, complete long paths, zero/unknown/unsaved/loading/error states, export continuity, connection warnings, stable header height, and short/unbroken long titles. Existing composer/provider/keyboard/file/image regressions passed; the 40,003-line fixture still uses64 dialog elements and retains all context.

Evidence: `/tmp/pico-browser/info-header/summary.json`, screenshots in that directory, and the `*-after-info/` reports. Stage: `/tmp/pico-info-header-dist` → `/home/kijana/.cache/pico-review/info-header-dist`. The preceding verified controls/reader stage is retained. Review services were stopped after publication.

## Message-details formatting — live

The per-message usage readout no longer puts a tinted bordered card against the sheet header. It uses a flat semantic definition list, consistent12px body padding, muted labels, and right-aligned tabular values. Time, input/output, cache read/write, total tokens, and cost are unchanged; missing usage still has its explicit message, and zero remains valid. The body scrolls inside short viewports so the final rows remain reachable.

This short readout uses the existing24rem compact-width token from the `sm` breakpoint upward, rather than spreading label/value pairs across the full48rem chat-column width. Narrow screens keep the full-width bottom sheet. That release was a local formatting correction in `AssistantMessage.svelte` and `MessageInfoRow.svelte`. The responsive drawer was authorized and implemented separately afterward; a docked sidebar remains a different, unimplemented interaction.

Verified live2026-10-15T18:32:28Z in `/tmp/pico-message-details-deployment.json`, frontend-only with host PID3688834 unchanged and old assets retained/index-last. Svelte0 errors/warnings, 30 files / 223 tests, and49 production-bundle browser cases passed. The original tinted/header-flush card was reproduced before the change; coverage includes full/zero/missing usage across320–1600px, light/dark, a220px-high viewport with accessible final rows, dismissal/copy, and existing session-info/export/header/keyboard behavior. No production session mutations. Evidence: `/tmp/pico-browser/message-details-after/summary.json` and before/after screenshots; stage `/tmp/pico-message-details-dist` → `/home/kijana/.cache/pico-review/message-details-dist`. Review preview service stopped; prior stage retained.

## Responsive modal panels — live

The shared sheet changes placement at a viewport width of64rem (1024CSS pixels at the default browser font size): below it, the existing bottom sheet; at or above it, a right-side modal drawer. This is a layout-space choice, not desktop/mobile detection. A narrow desktop window still gets the bottom sheet; a sufficiently wide touch window gets the drawer. The threshold leaves room for a40rem reader and24rem of backdrop context.

Drawers use the full available height with measured keyboard and safe-area bounds. Default controls/forms are28rem wide; message details are24rem; files, historical diffs, PDFs and images get up to48rem. Width is capped to retain24rem of backdrop, accounting for the right safe area. Compact layouts retain their existing width/height policies. Drawer headers reserve at least56px around the close action; no extra toolbar or explanation is added.

Bits UI still owns a single modal, backdrop, focus trap, Escape dismissal and return focus. The same mounted content changes geometry rather than swapping between separate mobile/desktop component trees. There is no docked sidebar or simultaneous background-chat interaction. The shared Svelte `MediaQuery` supplies one placement authority; no UA/PWA/pointer flag chooses layout, and the purpose-specific iPhone keyboard mechanism is unchanged.

The grabber and downward dismissal are active only in bottom-sheet mode. Drawer motion enters/exits from the right; bottom-sheet motion still uses the bottom; reduced motion disables both. Crossing the breakpoint tears down the drag owner, cancels its pending dismiss/spring-back and restores the panel/overlay's prior inline styles, including priorities. Returning narrow installs a fresh drag owner. Six regression tests cover teardown without interaction, active dragging, pending dismissal, pending spring-back, ordinary spring-back and reopen without unmounting.

The existing image/PDF pane sizing, PhotoSwipe gestures and PDF controls are unchanged. Their mounted viewers adapt to the containing panel's width; directory navigation, current/historical separation, reader-local scrolling and the file resource caches retain their existing ownership.

Implementation: `shared/ui/sheet/bottom-sheet-content.svelte`, `sheet-layout.ts`, `shared/gestures/sheet-drag.ts` and its tests, plus drawer-size selection in `AssistantMessage.svelte`, `FileSheet.svelte` and `ImageSheet.svelte`.

Verified live2026-10-15T19:28:43Z in `/tmp/pico-right-drawer-deployment.json`. Publication retained old hashes and switched the index last; live index/entry bytes, RPC privacy/auth/origin checks, and unchanged host PID3688834 were verified. No host restart or production session mutations; all three review services stopped.

Checks passed: Svelte0 errors/warnings,31 files /229 tests, production build, whitespace checks, and171 browser cases (161 production-bundle,10 isolated-dev continuity cases). The44 new cases cover320–1600px widths, both sides of1024px, narrow and wide220px-high windows, all panel families, same-node editor/value/caret/focus retention, pending mocked provider save, native diagnostic disclosure, source scroll offsets, image viewer identity, PDF page, historical snapshot identity, trapped/returned focus, backdrop click-through protection, simulated safe areas, correct opening/closing motion, reduced motion and resizing during native Chromium touch dragging. Existing summaries, export, compaction, model/provider, keyboard, reader, image and continuity regressions passed. The complete40,003-line historical fixture still has64 dialog elements.

Evidence: `/tmp/pico-browser/right-drawer/summary.json`, its screenshots/results and the `*-after-drawer/` reports. Stage: `/tmp/pico-right-drawer-dist` → `~/.cache/pico-review/right-drawer-dist`; previous Message-details stage/index retained. Browser evidence/dependencies were byte-compared and moved behind the `/tmp/pico-browser` symlink to `~/.cache/pico-review/browser` after tmpfs user quota interrupted an earlier screenshot. Browser profiles also use cache-backed TMPDIR. Two harness-only corrections expanded completed-turn tool disclosures and used the actual CDP `Emulation.setSafeAreaInsetsOverride` method. Browser resize/touch/safe-area simulations are not native iPhone verification.

## Model-picker search — implemented

Model selection now offers local type-to-filter search across model name, model ID, provider, and the existing option description. Space-separated terms can match across fields; compact names such as `gpt5` also match punctuated IDs. No request is issued per keystroke.

`ModelSelect.svelte` retains the current-model receipt even when filtering hides its row, reports result counts and genuine no-match states, offers a clear action that retains input focus, and preserves existing disabled options, optimistic selection, and error rollback. The model sheet keeps a stable height while filtering so the focused field does not move as the result count changes.

Implementation: `pico/src/features/chat/actions/ModelSelect.svelte`, `model-search.ts`, and `SessionSettingsView.svelte`.

## Keyboard-open header — confirmed mechanism, automatic integration

The app frame follows the unzoomed visual viewport's actual top/left offsets and dimensions. Sheets share its bounds without duplicate keyboard padding. Safe-area padding is retained when appropriate; pinch zoom does not chase or reflow the frame. The user confirmed the settled header position on the actual iPhone.

The opening defect was native outer-document focus scrolling, not lost safe-area padding. Baseline trace `52adda41-5d57-4e8a-9d89-e383cfa5fbaf` showed a 341px document pan/header displacement before the app compensated. Synchronous app updates and fixed/clip document styles alone did not prevent it. A one-paint opacity pulse also failed: trace `de97e0f4-ab8d-4b29-8500-91fdf921137e` showed the field visible again at 62 ms, before the native scroll at 75 ms.

The resize-bound opacity test succeeded on the actual device. Trace `ea1edc4e-51e5-4a76-85dc-19608156cf72` kept the field transparent through the visual-height shrink at 106 ms and app adaptation, restored it at 108 ms, and retained document scroll/header top 0 throughout five seconds. The user visually confirmed: **“yes with the test active it stayed!”**

### Normal-use behavior

`keyboard-focus.ts` installs the confirmed mechanism automatically for touch-driven focus of the composer/model search in an iPhone standalone app. It keeps the same native editor, its value, and its selection; it neither cancels the tap nor uses a proxy, blur/refocus sequence, or scroll-reset loop.

- Restore opacity on the paint following a measured viewport shrink, after the app can adapt its layout.
- Skip known already-open-keyboard focus switches, keyboard navigation, mouse focus, noneditable fields, and pinch zoom.
- Handle a fresh tap on the still-focused composer after keyboard dismissal, even when no new focus event is emitted.
- Restore immediately on typing, blur, another interaction, rotation/zoom, backgrounding, page departure, or app-shell teardown.
- Own the fallback with Effect and cancel it with the focus lease.

`MAX_FOCUS_HIDE_MS = 250` is a chosen product visibility-safety ceiling: a field must not remain transparent while waiting for an event that may never arrive, such as touch focus with a hardware keyboard. It is **not** an estimate of keyboard animation duration or a reason to delay restoration after resize. The confirmed 106 ms opening fits within it; a slower-than-budget opening deliberately falls back to a visible field and may not prevent native scrolling. There is no five-second diagnostic dependency in normal use.

### Cleanup

Removed the keyboard trace Settings card, arming/copy/report state, metadata readers, hidden safe-area probe, sample buffer and sampling loop, trace-only tests, app-update observer, old trial strategy/release-reason types, and one-paint opacity experiment. No diagnostic capture or telemetry remains.

Retained fixed/clip outer-document styling and the viewport updater's synchronous commit plus two bounded late-offset rereads. They are not sufficient by themselves to fix native opening, but they independently preserve non-scrollable app structure and handle measured late-offset/window-scroll cases. They were also present in the successful phone configuration; removing them would discard working behavior rather than remove dead code.

Implementation: `pico/src/shared/mobile/keyboard-focus.ts`, `focus-opacity.ts`, `viewport.ts`, `keyboard.svelte.ts`, `pico/src/app/shell/MobileViewport.svelte`, `KeyboardBoundary.svelte`, and `pico/src/shared/ui/sheet/bottom-sheet-content.svelte`.

### Verification

Verification passed: full workspace `pnpm check`, frontend build, 21 test files / 166 tests, and whitespace checks. Svelte diagnostics: zero errors/warnings; existing bundler/dependency warnings remain. All 34 controlled production-browser cases passed: 12 automatic-focus lifecycle cases, 12 retained viewport/model cases, and 10 waiting-state cases. No unhandled browser errors or real production writes.

Evidence: `/tmp/pico-browser/keyboard-focus-review/results.json`, its `settings-clean.png` and `keyboard-open.png`, `/tmp/pico-browser/keyboard-model-review/results.json`, and `/tmp/pico-browser/waiting-fixes-after-automatic-focus/results.json`. Browser simulations check activation, restoration, values/selection, no-resize fallback, repeat focus, model search, and retained viewport/waiting behavior; they do not prove native iPhone animation, hardware-keyboard behavior, or repeatability. The user subsequently confirmed the automatic normal-use fix on their phone: **“we’re good whew!!”** The reported keyboard/header defect is resolved. Rotation, hardware-keyboard interaction, and broader native lifecycle behavior remain separate verification work.
