# Files and images

## User flow

Use the persistent **files** folder icon in the conversation header. Browsing starts at that session's working directory, not a guessed home/project fallback. The host returns canonical paths, including through symlinks.

Directories sort first. Each row distinguishes a folder, ordinary file, or unavailable/special entry and shows file size when known. Use **parent directory**, **workspace**, the current-folder name filter, and the explicit hidden-files toggle. There are no write, delete, rename, or upload actions in this browser.

Folders and file previews share one stable-height panel and one fixed header; loading, filtering, errors, and different file formats do not stack or resize panels. At viewport widths below64rem it is the existing86dvh-bounded bottom sheet; at64rem and above it is a modal right drawer using the available height and up to48rem width, capped to retain24rem of backdrop context. Resizing changes the same mounted panel rather than replacing its contents; see [responsive modal panels](app-follow-ups.md#responsive-modal-panels--live). **Back to files** returns to the retained folder/filter; close dismisses the panel. Markdown file links use the same internal back trail. The filter is local and resets when the directory changes. Supported contents:

- UTF-8 text, Markdown, and syntax-highlighted code within the existing 1 MB text-display limit. Rendered prose wraps. Source files, fenced/indented code, and complete diffs preserve source lines and scroll horizontally within their own named, keyboard-focusable regions. Markdown tables retain semantic table markup inside an independent horizontal scroller; natural column widths and a 32ch paragraph-cell measure avoid crushing columns or creating unbounded single-line prose. The file-sheet header, surrounding prose, and page do not pan sideways. These Markdown overrides are scoped to file previews, not ordinary chat replies.
- PDFs with the existing PDF.js paging, zoom, text selection, open, and download actions.
- PNG, JPEG, GIF, WebP, and AVIF images with gesture-first viewing and a single **download image** icon beside close in the sheet header. The redundant image-only `open` action and separate action row are removed; PDFs retain their existing open/download controls. Images open fitted; pinch to zoom and drag to pan, double-tap to zoom in or return to fit. Trackpad/ordinary wheel scrolling pans; control/command-wheel zooms. There is no persistent zoom or fit toolbar. Keyboard users can focus the image pane and use `+`, `-`, arrows, and `0`; accessible buttons become visible on keyboard focus.

Recognition uses file signatures, not extensions. An image-named text file still opens as text. SVG is displayed as escaped source rather than served as an executable image document. Unsupported binary content and inaccessible files report a failure with retry rather than pretending they are empty.

Tool results already transport structured Pi `ImageContent` and previously displayed thumbnails. Those images now have a full-size preview action without depending on any guessed filesystem path or a tool-specific payload. Local Markdown image syntax becomes an explicit image-preview link, resolved through the existing session-relative file opener. External image behavior is retained; dangerous source schemes are not followed.

## Whole-file edit review

Read/write tool filenames open the current file. Successful edit filenames open a historical review: the entire saved file, with additions/removals inline, line numbers, and syntax highlighting when the language is supported. **Open current file** is a single icon beside close; back returns to the saved edit. The header identifies the saved edit without a second toolbar. Transcript tool controls retain their compact 32px height; changes need no extra heading, and the existing × communicates failure. Actual error detail remains available in the expanded tool.

Pi's built-in edit saves a patch with limited context, not a complete file image. `packages/host/src/edit-review.ts` delegates to the public `createEditToolDefinition()` and captures the exact read buffer and text passed to the write operation, separately for each invocation. Pi still owns argument preparation, fuzzy matching, BOM/CRLF handling, abort checks and the file-mutation queue. After text is encoded as UTF-8, the snapshot represents the bytes written, including replacement of lone UTF-16 surrogates. The replaceable inline extension yields to other extensions' edit implementations rather than overriding remote/custom file operations.

The tool's ordinary Pi result details retain a small `picoFileChange` reference. Full before/after text is stored separately under `HOST_DATA_DIR/file-changes/<sha256>` and fetched only on demand through authenticated `fs.change`. The hash names the entire serialized `{ path, before, after }` object and is checked again when reading. Snapshots are written through an owner-only temporary file and atomic rename; new directories are `0700`, files `0600`. RPC responses are private/no-store. Snapshot content is not added to model-facing result text, the normal chat stream, or browser persistence.

Each side uses the existing 1 MB text-viewing limit. The serialized pair has a 2 MB resource ceiling derived from those two file images; escaping can make an otherwise valid pair exceed it. Oversized/nontext content or storage failure produces explicit unavailable metadata, not a silently truncated file or a failed edit. A failed/aborted edit is never displayed as an applied historical diff. A snapshot delivery failure has its own retry state.

Full-file rendering follows jsdiff's contiguous runs rather than creating separate elements for every unchanged line. All context remains present and selectable, including large files; horizontal scrolling keeps source line numbers aligned. Syntax highlighting retains the existing character budget and falls back to plain text rather than dropping content. The existing 100 ms diff-computation budget falls back to a complete before/after replacement, never a partial file.

Historical context starts with edits executed by the newly loaded host extension. Older edits and nonparticipating overrides show one short **changed lines only** caption above their limited diff, not an explanatory block. Pico never reverse-applies them to today's file. Files that were changed or deleted later remain reviewable when their snapshot was saved.

These private artifacts intentionally do not expire with the current workspace file. They can contain all of an edited text file, so host backups should protect them like session history. They are not automatically removed when a Pico index row/session is deleted: externally retained/forked Pi histories can still reference them. A reference-aware orphan cleanup is not implemented. The browser retains only three recently opened immutable snapshots in memory, with owned Effect reads and interruption on departure.

## Ownership and continuity

Directory state is owned by the current requested path and hidden-files setting. Changing either immediately removes rows belonging to the previous path unless the requested target is cached. Departed responses cannot relabel or overwrite the current folder. Unknown/failed listings are distinct from successfully empty listings; retry stays in place. Cached directory revisits and same-folder refreshes retain usable content.

The browser retains eight recent listing variants, a product choice for a short navigation trail. The existing file cache retains three text/metadata entries. Neither cache stores image/PDF bytes or activates additional Pi runtimes. File reads and listing requests run as Effect fibers through the existing managed RPC runtime and are interrupted on departure. No new Promise-based resource helper was added.

Image interaction uses **PhotoSwipe 5.4.4** (MIT, no runtime dependencies), embedded using its public `appendToEl`, viewport-size, events, and slide APIs. The library owns touch tracking, pinch geometry, dragging, double-tap recognition, image bounds, and transform updates. The unshipped custom gesture/geometry engine was deleted.

Pico's adapter supplies pane dimensions/offsets, maps modifier-wheel focal coordinates into the embedded pane, bridges Safari trackpad gesture events without double-applying library touch pinches, and scopes keyboard/accessibility controls to this viewer. The existing sheet remains the only dialog/focus owner. Its image download action has a labeled, focusable 44×44 target, reserves title space, and stays available when image decoding fails. File images download the original authenticated bytes; inline tool images download their original supported raster data. Library controls and image-dismiss gestures are disabled; PDF interaction is unchanged. Desktop image clicks use the library's zoom toggle; touch uses its double-tap recognizer, with no competing browser double-click handler. Zoom/reset transitions are immediate rather than adding custom animation.

Double-tap targets twice the fitted size. Maximum zoom is the larger of four-times-fit or two CSS pixels per intrinsic image pixel, a chosen inspection policy so long screenshots can still be read at native resolution. Wheel sensitivity retains PhotoSwipe's mapping; keyboard zoom uses square-root-of-two steps and panning uses a tenth of the current pane. These are interaction policies, not lifecycle deadlines. Resize, event handlers, and the library instance are disposed with the preview.

Each filesystem preview instance/retry uses a fresh display URL to avoid reusing a stale or broken decoded-image resource. Inline tool-image data is immutable and restricted to supported raster media for opening/download. No page-scale, keyboard/header geometry, proxy input, or caret changes are introduced.

## Delivery and authorization

`FsListing` and image `FsFile` metadata are defined in `packages/protocol/src/index.ts`. `fs.ls` accepts `files` and `showHidden`; its default remains directory-only for the existing working-directory picker.

`/fs/image` streams original file bytes, including byte ranges and explicit attachment disposition. It shares the existing owner/origin gate, fetch-metadata restrictions, private/no-store policy, nosniff, and same-origin resource policy with PDF delivery. Raster format checks exclude active SVG/HTML content. Encoded images have a **20 MB preview ceiling**, a product limit for phone viewing; metadata RPC does not carry their base64 payloads. Signature inspection reads at most 16 bytes, derived from the supported format headers.

Protocol, host, and web must deploy together. The frontend is staged separately during verification so the running old host is not served a new filesystem contract prematurely. The initial image/listing routes required a host restart; historical reviews likewise require the new `fs.change` handler and edit-capture extension to be loaded. Publishing only the frontend is not sufficient.

## Outbox safety

Queued/pending messages are persisted whole: text, mode, original attachments, delivery identity, and retry state. Storage quota failure no longer retries a text-only form. Instead:

- Keep a copied whole-message fallback in memory, independent of the three-log cache.
- Remove an obsolete disk snapshot when possible so reload cannot resurrect older intent.
- Show **unsent messages couldn't be saved on this device · keep this page open**.
- Retry whole-message persistence on subsequent outbox updates; remove the fallback when persistence succeeds or messages clear.

The warning applies even when a pending item is represented by the host's live queue rather than the visible local outbox. Browser termination/reload durability is not promised after a storage failure. The change prevents silent image stripping; it is not an IndexedDB media-store migration and cannot recover attachments already lost by older versions.

## Verification

### Initial file/image delivery

Host/web typechecks, staged frontend build, host build, whitespace checks, and 23 test files / 182 tests passed for the initial file browser/image delivery implementation. New tests cover supported file signatures, misleading extensions, hidden/directory-only listings, canonical symlinks, unavailable entries, original image streams/ranges/download headers, authorization, unsupported/oversized images, safe inline media, and whole-message quota fallback/recovery.

45 controlled browser cases passed: 11 file/image/outbox cases, 10 waiting-state regressions, 12 automatic-focus regressions, and 12 viewport/model-search regressions. The current frontend was tested through the isolated Vite server; the fixture API served actual file/image/PDF code. Native Chromium image-document opening decoded successfully, and attachment download matched original bytes. No unhandled browser errors or production mutations occurred; all sends/settings/session changes/exports were intercepted or mocked. The isolated host smoke test also passed with temporary storage and a scripted model.

Evidence is under `/tmp/pico-browser/files-review/`, `waiting-fixes-after-files/`, `keyboard-focus-after-files/`, and `keyboard-model-after-files/`. Temporary fixture services were stopped after review.

The coordinated initial web/host update completed through the finished-turn/quiet-session gate at 2026-10-14 20:11:26. The subsequent gesture-only change is frontend-only and needs no host restart.

### Gesture-first viewer

The PhotoSwipe adapter passes web typechecking with no Svelte errors/warnings, a staged production build, and all 24 test files / 192 tests. Ten added tests verify embedding policies, offsets, wheel focal coordinates, keyboard scope, Safari-event delegation, failure forwarding, and teardown. The library engine itself is exercised through browser touch input rather than mocked gesture math.

55 controlled browser cases passed: 10 image-gesture cases, 11 file/image/outbox cases, 12 automatic-focus cases, 12 viewport/model cases, and 10 waiting-state cases. Gesture and viewport checks used the staged production bundle; internal-state regressions used the isolated development server. Coverage includes pinch/pan, double-tap/reset, touch cancellation, mouse click zoom/reset, wheel focal anchoring, ordinary scroll/pan, keyboard/accessibility controls, resize, and close/reopen cleanup. Safari trackpad events were exercised synthetically; that is not a native Safari test. No unhandled browser errors or production mutations occurred.

Evidence is under `/tmp/pico-browser/image-gestures-built/`, `files-after-gestures/`, `keyboard-focus-after-gestures/`, `keyboard-model-after-gestures/`, and `waiting-after-gestures/`. The frontend was published with the index switched last and previous hashed assets retained for open tabs. An authenticated request confirmed the running host serves the verified index. No host restart was needed; temporary review services were stopped.

### Image header cleanup

The image-only `open` link and body-level download row were removed. File and inline images now share `ImageDownload.svelte`: a labeled 44×44 download icon aligned beside the existing sheet close control. Header text reserves room for both actions; no shared sheet primitive or PDF control changed. Preview components now receive only their image source and label.

Web typechecking, all 192 tests, and the staged build passed. Fourteen file/header browser cases verified 320px layouts, long filename truncation, non-overlapping controls, original-byte file and inline-image downloads, retained PDF behavior, retry, and outbox safety. Ten production-bundle gesture regressions also passed, with no unhandled errors or production mutations. Evidence is under `/tmp/pico-browser/image-actions-review/` and `gestures-after-header/`.

The frontend update is live, verified through an authenticated request for its index. Existing hashed assets were retained; no host restart was needed. Temporary review services were stopped.

### Unified panel, historical reviews, header and list refinement

The protocol build, host typecheck/build, Svelte check (zero errors/warnings), all 28 test files / 214 tests, staged production web build, whitespace check, and isolated host smoke test passed on the final source. SDK integration tests verify that snapshot references survive session persistence and a third-party edit override wins. Other tests cover complete historical versions, UTF-8/BOM/CRLF behavior, concurrent calls, failed/aborted edits, storage failure, file permissions, byte limits, corrupt references, context-ring normalization, and complete diff-run reconstruction.

63 controlled browser cases passed: 18 file/history/header/list cases, one large-file production check, 10 production image-gesture cases, 12 production focus cases, 12 production viewport/model cases, and 10 waiting-state cases. These include unknown/post-compaction usage, disabled compaction while working, direct info/settings/files, 320px layout, stable sheet height, stale snapshot responses, saved versus current-file navigation, unavailable history, retry, original image downloads, the existing 17-page PDF, retained swipe transforms during 180ms reordering, and reduced motion. No browser errors or production session mutations occurred. The internal-state cases use the isolated development server; the large-file and gesture/keyboard cases use the staged production bundle.

A 40,003-line fixture exposed the initial per-line DOM cost: 160,060 dialog elements and about 7.3s opening on this desktop Chromium run. Grouping contiguous jsdiff runs reduced that to 61 elements and about 1.1s, with all context, both changed lines, accurate line numbers, and the final file marker retained. This is an observed before/after fixture result, not a native-phone latency promise.

Evidence: `/tmp/pico-browser/file-review/`, `dense-file-review/`, `gestures-after-file-review/`, `keyboard-focus-after-file-review/`, `keyboard-model-after-file-review/`, and `waiting-after-file-review/`. The original staged build was `/tmp/pico-file-review-dist`; that duplicate was removed for disk quota after live verification. Test-only fixes included clearing stale Vite module identities after rebuilding protocol dependencies and safely closing intercepted requests during browser teardown; neither required a product workaround.

Deployment uses a manifest-checked, external user unit after the current assistant turn finishes and sessions are quiet. It preserves old hashed assets and coordinates the web switch with the host restart. The post-restart verifier checks the live index and entry assets against the tested stage, the new read-only RPC handler, private/no-store, and rejection of unauthenticated/cross-origin requests. Its receipt `/tmp/pico-file-review-deployment.json` reports `verified` at 2026-10-15T12:44:08Z. The first verifier mistakenly sent an HTTP request array; correcting the read-only request to a single Request object confirmed the live release without another restart.

### Density and ordering follow-up

The frontend-only cleanup is live, verified at 2026-10-15T13:29:14Z in `/tmp/pico-ui-cleanup-deployment.json`. It removes redundant edit-review bars and tool-status captions, restores compact transcript tool controls, puts overflow after the context ring, and lets the composer model use the available width. Warm lists no longer regress through stored ordering, timestamp ties are deterministic, and metadata-only changes do not restart row motion.

Svelte checking reported zero errors/warnings; 29 test files / 218 tests and 59 controlled browser cases passed. The browser cases include the new compact layouts, unchanged refreshes, metadata updates during a genuine reorder, retained swipe/node identity, reduced motion, full historical context, image gestures, keyboard/focus behavior, model search, and waiting-state ownership. Evidence: `/tmp/pico-browser/ui-cleanup/summary.json`, `ui-cleanup/`, `session-twitch/`, `session-motion/`, `dense-ui-cleanup/`, and the `*-after-cleanup/` directories. That build was staged at `/tmp/pico-ui-cleanup-dist`; its redundant copy was later removed after live verification to recover disk quota. Its index is retained at `/tmp/pico-ui-cleanup-index.html`.

Publication retained existing hashed assets and switched the index last. Live index/assets and authorization were verified, the host PID was unchanged, and review services were stopped. No production session mutation occurred.

### Scoped reader scrolling and direct controls

The frontend follow-up is live, verified 2026-10-15T16:05:26Z in `/tmp/pico-controls-reader-deployment.json`. Source text and full historical diffs retain complete, unwrapped lines. Rendered Markdown prose wraps while semantic tables and code blocks have separate named scroll regions; highlighted/plaintext output shares the policy. Scroll-region wrappers survive asynchronous syntax highlighting without replacing their focus/scroll owner. Images and PDF controls are unchanged.

Svelte zero errors/warnings, all 223 tests, production build, whitespace checks, and 99 browser cases passed. The 24 new controls/reader cases include 320px/390px/desktop layouts, readable table columns, actual Chromium touch panning, keyboard/wheel scrolling, fixed header/prose/page geometry, linked-file back navigation, plaintext/highlighted source, historical diffs, explicit compaction behavior, and direct tree/export placement. The 40,003-line fixture still uses fewer than100 dialog elements with complete context and correct line heights. Existing image gestures, keyboard/model/provider flows, and continuity also passed. Evidence: `/tmp/pico-browser/controls-reader/summary.json`, `controls-reader/`, `dense-after-reader/`, and the other `*-after-reader/` directories.

Publication preserved old hashes and switched the index last. Live index/entry bytes and authorization were verified without a host restart or production session mutation. The new stage is cache-backed at `/home/kijana/.cache/pico-review/controls-reader-dist`, accessible through `/tmp/pico-controls-reader-dist`.

Desktop verification does not establish native iPhone downloads, long-press saving, pinch feel, or PWA termination recovery.
