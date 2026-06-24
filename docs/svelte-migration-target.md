# Pico Svelte 5 Target Architecture

This document describes the ideal target architecture for migrating `pico` from Solid UI to a modern Svelte 5 + shadcn-svelte application, ignoring churn and optimizing purely for a clean May 2026 architecture.

## Target summary

Rewrite Pico as a modern Svelte 5 + TypeScript + Capacitor SPA using:

- Svelte 5 runes
- Vite
- Capacitor 8+
- Tailwind CSS 4
- shadcn-svelte
- Bits UI
- @lucide/svelte
- strict feature/domain boundaries

Do not preserve Solid compatibility patterns. Treat the migration as a clean Svelte-native frontend rewrite while keeping the Pico host and shared protocol intact.

## Proposed directory layout

```txt
pico/
  src/
    app/
      App.svelte
      routes.ts
      shell/
        AppShell.svelte
        MobileViewport.svelte
        KeyboardBoundary.svelte
        AppLifecycle.svelte

    routes/
      sessions/
        SessionsPage.svelte
      session/
        SessionPage.svelte
      settings/
        SettingsPage.svelte
      onboarding/
        OnboardingPage.svelte

    features/
      sessions/
        components/
        model/
        api.ts
        session-list.state.svelte.ts
      chat/
        components/
        input/
        message-list/
        permissions/
        actions/
        model/
        chat-session.state.svelte.ts
        active-session.state.svelte.ts
        chat-log.state.svelte.ts
        retry-state.svelte.ts
        stream-controller.ts
      settings/
        components/
        settings.state.svelte.ts
      onboarding/
        components/

    shared/
      ui/
        button/
        dialog/
        sheet/
        input/
        textarea/
        carousel/
        drawer/
        sonner/
      components/
        Header.svelte
        StatusDot.svelte
        EmptyState.svelte
        ErrorBanner.svelte
      gestures/
        edge-swipe.ts
        long-press.ts
        pull-to-refresh.ts
        swipe-action.ts
      mobile/
        keyboard.ts
        haptics.ts
        lifecycle.ts
        speech.ts
        image-picker.ts
      lib/
        api-client.ts
        format.ts
        utils.ts
        highlighter.ts
      types/

    protocol/
      index.ts

    main.ts
    index.css
```

Guiding principle: **routes are thin, features own behavior, shared owns reusable primitives, and rune-backed state modules are colocated with domain behavior.**

## Core stack

### Runtime/UI

```txt
Svelte 5
TypeScript strict
Vite
Capacitor 8+
Tailwind CSS 4
shadcn-svelte
Bits UI
@lucide/svelte
```

### State

Use Svelte 5 runes-first state modules for app and domain state.

Prefer:

```ts
// *.state.svelte.ts
let sessions = $state<SessionMeta[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);

export const sessionListState = {
  get sessions() {
    return sessions;
  },
  get loading() {
    return loading;
  },
  get error() {
    return error;
  },
  async refresh() {
    // ...
  },
};
```

Avoid defaulting to classic `writable()` unless interoperability requires it.

Use:

- `$state` for mutable local/domain state
- `$derived` for computed state
- `$effect` for lifecycle-driven reactions inside components
- explicit controller classes/modules for async streams and imperative browser/mobile APIs

## Routing model

Because this is a Capacitor SPA, avoid SvelteKit initially unless the app explicitly wants its routing/build model.

Target:

```txt
Vite SPA
hash or history router
typed route helpers
route-level code splitting
```

Example route helpers:

```ts
// src/app/routes.ts
export const routes = {
  sessions: "/",
  session: (id: string) => `/s/${id}`,
  settings: "/settings",
  onboarding: "/onboarding",
};
```

Route components:

```txt
src/routes/sessions/SessionsPage.svelte
src/routes/session/SessionPage.svelte
src/routes/settings/SettingsPage.svelte
src/routes/onboarding/OnboardingPage.svelte
```

Routes should mostly compose feature components and call feature state/controllers. They should not contain large business logic.

## UI architecture

### shadcn-svelte primitives

Use shadcn-svelte for:

```txt
Button
Input
Textarea
Dialog
Sheet
Drawer
Command
Popover
Dropdown Menu
Tabs
Switch
Sonner
Carousel
Scroll Area
```

Generated components live under:

```txt
src/shared/ui/
```

Example:

```txt
src/shared/ui/button/button.svelte
src/shared/ui/sheet/sheet-content.svelte
src/shared/ui/dialog/dialog-content.svelte
```

Feature components import shared UI primitives:

```svelte
<script lang="ts">
  import { Button } from "@/shared/ui/button";
  import * as Sheet from "@/shared/ui/sheet";
</script>
```

### Design system layer

Keep the visual language in CSS variables and Tailwind utilities.

`src/index.css` owns:

- color tokens
- radius tokens
- safe-area variables
- mobile viewport sizing
- hairline borders
- terminal/chat typography
- dark mode defaults

Example direction:

```css
:root {
  --color-bg: oklch(...);
  --color-fg: oklch(...);
  --color-surface: oklch(...);
  --color-border: oklch(...);

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;

  --safe-top: env(safe-area-inset-top);
  --safe-bottom: env(safe-area-inset-bottom);
}
```

shadcn components should be adapted to these tokens rather than bringing in a second visual system.

## Mobile shell

Have a dedicated shell stack:

```txt
src/app/shell/AppShell.svelte
src/app/shell/MobileViewport.svelte
src/app/shell/KeyboardBoundary.svelte
src/app/shell/AppLifecycle.svelte
```

### `MobileViewport.svelte`

Responsibilities:

- full-height app container
- safe-area handling
- overscroll behavior
- background color
- native-like scrolling boundaries

### `KeyboardBoundary.svelte`

Responsibilities:

- Capacitor Keyboard listeners
- visual viewport fallback
- bottom inset state
- input bar offset
- manual/automatic avoidance modes

### `AppLifecycle.svelte`

Responsibilities:

- Capacitor App resume/pause listeners
- exposes lifecycle ticks to domain controllers
- reconnects streams on resume

### `AppShell.svelte`

Composes:

```svelte
<MobileViewport>
  <AppLifecycle>
    <KeyboardBoundary>
      <Router />
    </KeyboardBoundary>
  </AppLifecycle>
</MobileViewport>
```

## Data/API layer

Keep `packages/protocol/` as the shared source of truth.

In mobile:

```txt
src/shared/lib/api-client.ts
src/features/sessions/api.ts
src/features/chat/api.ts
```

Pattern:

```ts
// shared/lib/api-client.ts
export class ApiClient {
  constructor(private baseUrl: string) {}

  healthcheck() {}
  listSessions() {}
  createSession() {}
  patchSession() {}
  deleteSession() {}
  connectSessionStream() {}
}
```

Feature APIs wrap intent:

```ts
// features/sessions/api.ts
export async function loadSessionList(client: ApiClient, opts: LoadOptions) {
  return client.listSessions(opts);
}
```

No component should manually build host URLs or call `fetch` directly.

## Chat streaming architecture

This is the most important part of the migration.

Target split:

```txt
features/chat/
  model/
    chat-log.state.svelte.ts
    active-session.state.svelte.ts
    retry-state.svelte.ts
    message-index.ts
  stream-controller.ts
  components/
    MessageList.svelte
    MessageRow.svelte
    AssistantMessage.svelte
    UserMessage.svelte
    ToolCall.svelte
    PermissionGate.svelte
    InputBar.svelte
```

### Stream controller

Imperative stream lifecycle should not live directly in a Svelte component.

Target:

```ts
export class SessionStreamController {
  constructor(opts: {
    sessionId: string;
    client: ApiClient;
    getCursor: () => number;
    onEvent: (event: WireEvent) => void;
    onStatus: (status: ConnectionStatus) => void;
  }) {}

  start(): Promise<void> {}
  reconnect(): void {}
  close(): void {}
  send(input: SendPayload): Promise<void> {}
}
```

`SessionPage.svelte` should remain thin and delegate composition/lifecycle to a feature screen:

```svelte
<script lang="ts">
  import ChatSessionScreen from "@/features/chat/ChatSessionScreen.svelte";

  let { id }: { id: string } = $props();
</script>

{#key id}
  <ChatSessionScreen sessionId={id} />
{/key}
```

`ChatSessionScreen.svelte` creates `createChatSessionState(sessionId)`, starts it on mount, and stops it on unmount.

### Chat log state

Use an indexed mutable model, not repeated array scans.

```ts
type ChatLogState = {
  entries: LogEntry[];
  cursor: number;
  indexById: Map<string, number>;
};
```

Expose high-level methods:

```ts
chat.applyWireEvent(event);
chat.appendUserMessage(entry);
chat.applyAssistantDelta(id, text);
chat.finishAssistantMessage(event);
chat.updateToolResult(event);
```

Components should never know wire-event mutation details.

## Gesture architecture

Custom mobile gestures should be implemented as Svelte actions where possible.

```txt
src/shared/gestures/
  edge-swipe.ts
  swipe-action.ts
  pull-to-refresh.ts
  long-press.ts
```

Example usage:

```svelte
<script lang="ts">
  import { edgeSwipe } from "@/shared/gestures/edge-swipe";
</script>

<div use:edgeSwipe={{ href: "/", preview }}>
  ...
</div>
```

Gesture actions should:

- own pointer/touch listeners
- expose callbacks
- clean up deterministically
- avoid app state imports
- be unit-testable as imperative modules

Components like `EdgeSwipeBack.svelte` can wrap the action for layout/preview composition.

## Feature boundaries

### Sessions feature

Owns:

```txt
session list loading
archive toggle
rename
delete
cwd picker
new session sheet
```

State:

```txt
session-list.state.svelte.ts
```

Responsibilities:

```ts
sessionList.refresh();
sessionList.create(opts);
sessionList.rename(id, title);
sessionList.archive(id, archived);
sessionList.delete(id);
sessionList.setArchivedView(value);
```

### Chat feature

Owns:

```txt
streaming
message log
input composer
image attachments
slash palette
permissions
agent actions
tool rendering
markdown rendering
```

### Settings feature

Owns persisted preferences:

```txt
host URL
theme-ish preferences
auth/session settings
speech settings
debug options
```

Backed by Capacitor Preferences through a small repository module.

### Shared mobile

Owns direct Capacitor APIs:

```txt
haptics
keyboard
speech
camera/image picker
app lifecycle
preferences adapter
```

Feature code should call these through stable wrappers.

## Rendering strategy

Use Svelte's strengths.

### Local state in components

```svelte
<script lang="ts">
  let open = $state(false);
  let saving = $state(false);
</script>
```

### Domain state in rune modules

```ts
// *.state.svelte.ts
let connection = $state<ConnectionState>("offline");

export const connectionState = {
  get value() {
    return connection;
  },
  set(value: ConnectionState) {
    connection = value;
  },
};
```

### Expensive derived values

```ts
let visibleSessions = $derived(
  sessions.filter((s) => s.archived === archivedView),
);
```

### DOM update timing

Use `tick()` for:

- scroll-to-bottom after message append
- keyboard transition adjustment
- measuring input bar height
- markdown render completion

## File naming conventions

Use:

```txt
PascalCase.svelte        components
kebab-case.ts            utilities
*.state.svelte.ts        rune-backed state modules
*.controller.ts          imperative lifecycle controllers
*.types.ts               local types
*.schema.ts              validation schemas
```

Examples:

```txt
ChatSessionPage.svelte
InputBar.svelte
chat-session.state.svelte.ts
stream-controller.ts
host-client.ts
```

## Testing target

The ideal architecture should support:

```txt
Vitest
Testing Library Svelte
Playwright component/e2e where useful
Capacitor device smoke tests
```

High-value test targets:

- `applyWireEvent`
- stream reconnect behavior
- session list mutations
- settings persistence
- route helpers
- gesture threshold math
- API client protocol validation

## Build target

Suggested `package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build && tsc --noEmit",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "preview": "vite preview",
    "cap:sync": "cap sync",
    "cap:ios": "cap sync ios && cap open ios",
    "cap:android": "cap sync android && cap open android"
  }
}
```

Recommended checks:

```bash
pnpm --filter pico check
pnpm --filter pico build
```

## Ideal dependency shape

```json
{
  "dependencies": {
    "@capacitor/core": "...",
    "@capacitor/app": "...",
    "@capacitor/keyboard": "...",
    "@capacitor/haptics": "...",
    "@capacitor/preferences": "...",
    "@capacitor/camera": "...",
    "@capacitor-community/speech-recognition": "...",

    "@pico/protocol": "workspace:*",

    "svelte": "^5.x",
    "bits-ui": "^2.x",
    "@lucide/svelte": "^1.x",
    "class-variance-authority": "^0.x",
    "clsx": "^2.x",
    "tailwind-merge": "^3.x",
    "tailwind-variants": "^3.x",
    "svelte-sonner": "^1.x",
    "vaul-svelte": "1.0.0-next.x",

    "partysocket": "^1.x",
    "shiki": "^4.x",
    "streaming-markdown": "^0.x",
    "diff": "^9.x"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.x",
    "svelte-check": "^4.x",
    "typescript": "^5.x",
    "vite": "^8.x",
    "tailwindcss": "^4.x",
    "@tailwindcss/vite": "^4.x"
  }
}
```

## Perfect end state

Architecturally:

```txt
Capacitor native shell
  ↓
Svelte 5 SPA shell
  ↓
typed router
  ↓
thin route pages
  ↓
feature-owned state/controllers
  ↓
shared API client
  ↓
@pico/protocol schemas/types
  ↓
host
```

Visually:

```txt
shadcn-svelte primitives
  ↓
Pico design tokens
  ↓
feature-specific compositions
  ↓
native-feeling mobile gestures
```

Key architectural decision: **do not merely translate Solid components to Svelte.** Build a Svelte-native app where:

- reactivity is rune-based
- async streaming is controller-based
- gestures are actions
- UI primitives are shadcn-svelte/Bits UI
- route pages are thin
- protocol and API boundaries are explicit
- mobile concerns live in one shell/mobile layer
