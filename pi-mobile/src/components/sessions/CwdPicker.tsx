import {
  createSignal,
  createResource,
  For,
  Show,
  type JSX,
} from "solid-js";
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  Home,
  X,
  Check,
} from "lucide-solid";
import { lsFs, type FsListing } from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";

/**
 * Cwd picker.
 *
 * Mounts as a full-screen overlay (the parent NewSessionSheet decides
 * when to show it). Drill-down navigation:
 *
 *   - Tap a directory   → drill into it
 *   - Tap "up"           → go to parent
 *   - Tap "home"         → jump to user's home directory
 *   - Tap "use this"     → return current path to caller, close
 *   - Tap X              → close without changing
 *
 * Breadcrumb at the top renders the active path in ellipsized segments.
 * Each segment is tappable as a shortcut.
 */
interface Props {
  /** Initial path; defaults to home (server-side). */
  initial?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export default function CwdPicker(props: Props): JSX.Element {
  const [path, setPath] = createSignal<string | undefined>(props.initial);

  // Fetch the listing for the active path. Re-runs on path change.
  // Solid does not run a resource fetch when the source is undefined, but
  // undefined is exactly how this picker asks the bridge for its default root.
  // Use an empty-string sentinel so the first open fetches /fs/ls immediately.
  const [listing] = createResource<FsListing, string>(
    () => path() ?? "",
    async (p) => {
      const baseUrl = await getBridgeUrl();
      return lsFs(baseUrl, p || undefined);
    },
  );

  const drill = (name: string) => {
    const l = listing();
    if (!l) return;
    // Build child path with the server's reported separator agnostic.
    // We don't know the separator a priori (could be Windows), but the
    // server always returns absolute paths. Joining with "/" works on
    // POSIX; Node's resolve() will normalize either way server-side.
    setPath(`${l.path.replace(/\/$/, "")}/${name}`);
  };

  const goUp = () => {
    const l = listing();
    if (l?.parent) setPath(l.parent);
  };

  const goHome = () => {
    const l = listing();
    if (l) setPath(l.home);
  };

  return (
    <div class="fixed inset-0 z-50 flex flex-col bg-[color:var(--color-bg)]">
      {/* ── header */}
      <div
        class="hairline-b flex items-center gap-1 px-2"
        style={{ "padding-top": "env(safe-area-inset-top)" }}
      >
        <button
          type="button"
          onClick={props.onCancel}
          class="flex h-10 w-10 items-center justify-center text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
          aria-label="Cancel"
        >
          <X size={16} />
        </button>
        <span class="text-[12px] font-medium">choose directory</span>
        <button
          type="button"
          onClick={goHome}
          class="ml-auto flex h-10 w-10 items-center justify-center text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
          aria-label="Home"
          title="Go to home directory"
        >
          <Home size={14} />
        </button>
      </div>

      {/* ── breadcrumb */}
      <Breadcrumb path={listing()?.path} home={listing()?.home} onJump={setPath} />

      {/* ── listing */}
      <div class="flex-1 overflow-y-auto">
        <Show when={listing.loading}>
          <div class="px-3 py-3 text-[12px] text-[color:var(--color-fg-faint)]">
            loading…
          </div>
        </Show>
        <Show when={listing.error}>
          <div class="px-3 py-3 text-[12px] text-[color:var(--color-danger)]">
            {String(listing.error)}
          </div>
        </Show>
        <Show when={listing()}>
          {(l) => (
            <>
              <Show when={l().parent !== null}>
                <button
                  type="button"
                  onClick={goUp}
                  class="hairline-b flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-[color:var(--color-surface)]"
                >
                  <ChevronLeft
                    size={14}
                    class="text-[color:var(--color-fg-muted)]"
                  />
                  <span class="text-[12.5px] text-[color:var(--color-fg-muted)]">
                    ..
                  </span>
                </button>
              </Show>
              <For
                each={l().entries}
                fallback={
                  <div class="px-3 py-3 text-[12px] text-[color:var(--color-fg-faint)]">
                    (no subdirectories)
                  </div>
                }
              >
                {(entry) => (
                  <button
                    type="button"
                    onClick={() => drill(entry.name)}
                    class="hairline-b flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-[color:var(--color-surface)]"
                  >
                    <Folder
                      size={13}
                      class="shrink-0 text-[color:var(--color-fg-muted)]"
                    />
                    <span class="min-w-0 flex-1 truncate text-[12.5px]">
                      {entry.name}
                    </span>
                    <ChevronRight
                      size={12}
                      class="shrink-0 text-[color:var(--color-fg-faint)]"
                    />
                  </button>
                )}
              </For>
            </>
          )}
        </Show>
      </div>

      {/* ── select footer */}
      <div
        class="hairline-t sticky bottom-0 bg-[color:var(--color-bg)]/95 backdrop-blur-md p-2"
        style={{
          "padding-bottom": "calc(env(safe-area-inset-bottom) + 0.5rem)",
        }}
      >
        <button
          type="button"
          onClick={() => {
            const l = listing();
            if (l) props.onSelect(l.path);
          }}
          disabled={!listing()}
          class="flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--color-accent)] text-[12px] font-medium text-[color:var(--color-bg)] active:opacity-80 disabled:opacity-40"
        >
          <Check size={14} strokeWidth={2.5} />
          use this directory
        </button>
      </div>
    </div>
  );
}

/* ── breadcrumb ──────────────────────────────────────────────────────── */

/**
 * Segmented breadcrumb. Replaces the user's home directory with "~"
 * for compactness, then shows each path component as a tappable chip.
 */
function Breadcrumb(props: {
  path: string | undefined;
  home: string | undefined;
  onJump: (path: string) => void;
}): JSX.Element {
  const segments = () => {
    const p = props.path;
    const h = props.home;
    if (!p) return [];
    // Replace the home prefix with "~" when applicable
    let display = p;
    let basePath = "/";
    if (h && (p === h || p.startsWith(h + "/"))) {
      display = p === h ? "~" : `~${p.slice(h.length)}`;
      basePath = h;
    }
    const parts = display.split("/").filter(Boolean);
    if (display.startsWith("~")) {
      // ~ becomes the home segment, with absolute path = home dir
      return parts.map((name, i) => ({
        name,
        path:
          i === 0
            ? basePath
            : `${basePath}/${parts.slice(1, i + 1).join("/")}`,
      }));
    }
    // POSIX absolute path: each segment maps to its absolute prefix
    return parts.map((name, i) => ({
      name,
      path: `/${parts.slice(0, i + 1).join("/")}`,
    }));
  };

  return (
    <div class="hairline-b overflow-x-auto px-2 py-1.5">
      <div class="flex items-center gap-0.5 whitespace-nowrap">
        <For each={segments()}>
          {(s, i) => (
            <>
              <Show when={i() > 0}>
                <ChevronRight
                  size={10}
                  class="shrink-0 text-[color:var(--color-fg-faint)]"
                />
              </Show>
              <button
                type="button"
                onClick={() => props.onJump(s.path)}
                class="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
              >
                {s.name}
              </button>
            </>
          )}
        </For>
      </div>
    </div>
  );
}
