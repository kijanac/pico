# Changelog

All notable changes to Pico.

## 1.4.5 — 2026-06-30

### Added
- Add composer scroll scrim

## 1.4.4 — 2026-06-30

### Removed
- Remove composer blur overlay

## 1.4.3 — 2026-06-30

### Fixed
- Fix mobile attachments and chat UI polish

## 1.4.2 — 2026-06-30

### Added
- Add Pi-shaped image messages

### Changed
- Support generic provider auth selection
- Use uuid v7 in host smoke send
- Require send idempotency keys
- Require explicit send mode
- Stabilize send pointer lifecycle
- Float composer above chat fade

### Removed
- Remove legacy host preference migration
- Remove redundant send cancel binding

## 1.4.1 — 2026-06-30

### Added
- Add host management affordance

### Changed
- Smooth older chat scrollback

## 1.4.0 — 2026-06-29

### Added
- Add multi-host mobile support

### Changed
- Replace ad hoc route matching
- Tighten host default selection
- Simplify multi-host defaults
- Keep send target stable while busy
- Make agent thinking handoff state-driven

### Removed
- Remove legacy session route

## 1.3.1 — 2026-06-29

### Changed
- Gate timing and remove legacy migrations
- Simplify tool details presence check
- Polish tool result details rendering
- Page session history on demand
- Tail-render chat history
- Instrument session open timing
- Improve chat queue and context feedback
- Improve chat mobile progress feedback

### Fixed
- Fix ordered list indent in chat markdown

## 1.3.0 — 2026-06-25

### Added
- Add unified pico-host install + signed auto-updater
- Add a one-command pnpm release script

### Changed
- Generate the changelog with git-cliff

### Fixed
- Fix false "Tailscale not connected" from an impatient health probe

## 1.2.0 — 2026-06-24

### Added
- Add a Vitest suite (auth + protocol) and run it in CI
- Add PR/push CI and auto-generated release notes
- Add in-app QR scanner for offline pairing
- Add light-mode support for code display

### Changed
- Replace the cloud-host wizard with a guided onboarding
- Render the pairing QR at low error-correction
- Rename the mobile app directory pi-mobile → pico

### Fixed
- Fix host-card flicker by lifting host status to a shared store

## 1.1.0 — 2026-06-24

### Added
- Surface extension commands in the slash palette
- Add console OpenTelemetry tracing to the host (dev, gated)
- Add @effect/rpc protocol contract
- Add Pico light theme switcher

### Changed
- Rotate the host release signing key
- Keep steer/queue as a quiet long-press, not an explicit control
- Redesign the composer as a single card with in-row controls
- Polish extension UI: prompt sheet, notifications, custom-tool card
- Load host pi extensions (phase 1): createAgentSession in the live path
- Lower minimum Node to 22.19.0 (match the Pi SDK floor)
- Use the SDK's exported VERSION instead of reading its package.json
- Upgrade Pi SDK 0.75.5 -> 0.79.10
- Migrate host-internal errors to Data.TaggedError
- Route chat-side errors through the host-issue classifier
- Single-source the WireEvent->LogEntry fold (self-contained assistant_end)
- Extract connectAndClaimHost primitive
- Single-source the loopback admin status/pairing contract
- Extract shared Pico RPC client-layer builders
- Refactor audit batch 1: quick wins + two correctness fixes
- Trim useless copy from the appearance card
- Update iOS SwiftPM Package.resolved from cap sync
- Polish connection/permission UX (device-test findings)
- Allow trace-propagation headers through host CORS
- Simplify dead WS scaffolding after the @effect/rpc migration
- Migrate the mobile session stream to the @effect/rpc WebSocket client
- Serve the session channel over @effect/rpc WebSocket transport (host)
- Aggressively prune unjustified comments across the codebase
- Rename host-runtime to host; fold host control plane into the CLI
- Replace hand-rolled CLI arg parsing with @effect/cli
- Migrate host-runtime off node:fs onto @effect/platform FileSystem
- Migrate the mobile client to @effect/rpc
- Serve the host over @effect/rpc; unify the runtime
- Replace Hono with @effect/platform HttpApi
- Scaffold typed HttpApi contract (WIP: HttpApi phase)
- Migrate host config, protocol, and process/fs I/O onto Effect
- Simplify setup error handling
- Dedupe CLI diagnostics and serving setup
- Simplify host setup orchestration
- Rename bridge to Pico host and improve setup flow

### Fixed
- Fix release CI: build @pico/protocol before its consumers
- Fix permission layout and retry placement (device-test, take 2)

### Removed
- Delete the bespoke permission path
- Delete dead commands.ts and the commands.list RPC
- Drop the resolved-theme line from the appearance card
- Remove unused class-variance-authority from pi-mobile
- Drop the internal host barrel; import host modules directly
- Delete the tRPC contract; retire tRPC and Valibot

## 1.0.2 — 2026-06-15

### Changed
- Make tool-arg parsing total so model shape variants can't crash a turn
- Reconcile orphaned turn state when the bridge restarts mid-turn

## 1.0.1 — 2026-06-12

### Added
- Add first-run welcome flow and truthful initial states

### Changed
- Harden bridge auth: fail closed, keep tailscale key off disk
- Copy concision and comment deletion pass over recent work

## 1.0.0 — 2026-06-12

### Added
- Add drag-to-dismiss with spring snap to bottom sheets
- Add optimistic send echo
- Add perf upgrades: delta coalescing, lazy routes, compression, config tuning
- Add single-command version bumping

### Changed
- Adopt Pico app icon and dev.picomobile.app bundle id; add Android platform
- Tidy types and comparisons in today's changes
- Clarify lazy route cache
- Animate screen navigation with push/pop transitions
- Cut chat rendering cost during streaming and on long sessions
- Make sends idempotent with clientId; add failed-send retry
- Make Effect defects observable at bridge boundaries
- Roll back failed push deploys
- Trim mobile startup chunk and dedupe sheet headers
- Bound bridge memory growth

### Fixed
- Fix TestFlight build number resolution to filter by version train

### Removed
- Delete dead code: stray smoke scripts, unused UI variants, legacy compat

## 0.9.6 — 2026-06-06

### Added
- Add mobile-native Pi extension UI support

### Changed
- Stream generic tool updates
- Rebrand mobile app to Pico

## 0.9.5 — 2026-06-04

### Changed
- Avoid typography color utility collisions

## 0.9.4 — 2026-06-04

### Changed
- Extract reusable action row
- Normalize mobile typography
- Simplify tRPC usage and remove duplicate REST routes
- Update session delete confirmation copy

## 0.9.3 — 2026-06-03

### Changed
- Patch Node types for UUIDv7
- Simplify settings and remove faux provider
- Import native UUIDv7 directly
- Use native Node UUIDv7
- Use UUIDv7 for bridge-generated ids
- Show expandable compaction summaries
- Evict idle bridge sessions

### Removed
- Remove UUIDv7 type augmentation

## 0.9.2 — 2026-06-03

### Changed
- Use incremental session replay
- Harden queue state projection

## 0.9.0 — 2026-06-03

### Changed
- Show compaction state in chat
- Share HTML export as file attachment
- Improve quick action rail visibility

## 0.8.0 — 2026-06-02

### Added
- Add inline slash command autocomplete

### Changed
- Improve queue updates and compact action
- Show context usage in chat header
- Replace input add sheet with action rail
- Share sessions home preview layout
- Improve HTML export sharing

## 0.7.2 — 2026-06-02

### Added
- Add native HTML session export action

### Changed
- Simplify session menu items
- Clean up input bar and keyboard inset handling
- Refactor chat input sheets and autosize

## 0.7.1 — 2026-06-02

### Added
- Add cwd to session stats protocol

### Changed
- Refine chat action menus
- Align mobile sessions with Pi TUI cwd model

## 0.7.0 — 2026-06-02

### Changed
- Persist mobile chat drafts
- Refine mobile session branching UX

## 0.6.2 — 2026-06-01

### Changed
- Expand mobile provider auth options

## 0.6.1 — 2026-06-01

### Fixed
- Fix mobile session chrome layout

## 0.6.0 — 2026-06-01

### Added
- Add bridge smoke tests

### Changed
- Migrate bridge control plane to tRPC
- Extract Svelte screen state controllers
- Refine Svelte feature architecture
- Migrate pi-mobile to Svelte architecture

## 0.5.2 — 2026-05-31

### Added
- Add mobile-triggered bridge updates

### Changed
- Fold model selection into session controls

## 0.5.1 — 2026-05-30

### Added
- Add guided bridge onboarding

### Changed
- Use generic session settings controls
- Consolidate bridge auth services

## 0.5.0 — 2026-05-30

### Changed
- Isolate sessions on per-session git branches
- Replace session long-press actions with swipe actions

### Fixed
- Fix settings screen safe-area layout

## 0.4.10 — 2026-05-30

### Changed
- Differentiate queued user messages
- Harden bridge setup and fallback semantics
- Prevent session row text selection on long press
- Write HTML exports to bridge data dir

## 0.4.9 — 2026-05-29

### Changed
- Hide branch picker when unavailable
- Allow session creation while git detection runs

### Removed
- Remove legacy compatibility adapters

## 0.4.8 — 2026-05-29

### Added
- Add git branch picker with per-session worktrees

### Changed
- Prepare 0.4.8 patch release

## 0.4.5 — 2026-05-29

### Fixed
- Fix mobile session controls

## 0.4.3 — 2026-05-28

### Changed
- Apply chat-level keyboard inset

## 0.4.2 — 2026-05-28

### Changed
- Make keyboard avoidance explicit

## 0.4.1 — 2026-05-28

### Fixed
- Fix mobile keyboard avoidance

## 0.4.0 — 2026-05-28

### Added
- Add mobile session utilities and shared UI primitives

## 0.3.1 — 2026-05-28

### Changed
- Use valid App Store Connect build filters
- Resolve TestFlight build number with Node
- Use GitHub run number for TestFlight builds
- Generate App Store Connect JWT with PyJWT
- Use global TestFlight build number sequence
- Flatten bridge HTTP and group mobile features
- Split bridge HTTP routes from server boot
- Centralize bridge HTTP error handling
- Split session agent action views
- Rename branch navigator to tree
- Derive TestFlight build number from App Store Connect

## 0.3.0 — 2026-05-28

### Added
- Add mobile provider auth flow
- Add native session tree settings and info

### Changed
- Resume streams from latest cursor
- Retry bridge health checks during deploy

## 0.2.2 — 2026-05-28

### Added
- Add signed bridge auto updates
- Add self-service bridge cloud-init setup

### Fixed
- Fix user message overflow

## 0.2.1 — 2026-05-28

### Changed
- Polish chat controls and cleanup mobile protocol

## 0.2.0 — 2026-05-28

### Changed
- Clean up protocol validation and pi adapters

## 0.1.1 — 2026-05-28

### Added
- Add edge swipe back gesture
- Add iOS native permission descriptions
- Add TestFlight deployment workflow
- Add mobile model picker and compaction

### Changed
- Revert "Use app-scoped iOS provisioning setting"
- Use app-scoped iOS provisioning setting
- Configure signing only on app target
- Avoid applying provisioning profile to package targets
- Use pre-1.0 TestFlight version
- Harden TestFlight secret decoding
- Restore session scrolling
- Hide unsupported TUI slash commands
- Stabilize mobile keyboard and session replay
- Set up mobile workspace and deployment
- Initial import


