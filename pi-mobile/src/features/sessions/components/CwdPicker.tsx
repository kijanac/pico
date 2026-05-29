import {
  createSignal,
  createResource,
  For,
  Show,
} from "solid-js";
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  Home,
  Check,
} from "lucide-solid";
import { lsFs, type FsListing } from "@/lib/api";
import { getBridgeUrl } from "@/lib/settings";

interface Props {
  initial?: string;
  onSelect: (path: string) => void;
}

export default function CwdPicker(props: Props) {
  const [path, setPath] = createSignal<string | undefined>(props.initial);

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
    <div class="flex min-h-0 flex-1 flex-col bg-[color:var(--color-bg)]">
      <div class="hairline-b flex items-center gap-2 px-2 py-1.5">
        <Breadcrumb path={listing()?.path} home={listing()?.home} onJump={setPath} />
        <button
          type="button"
          onClick={goHome}
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
          aria-label="Home"
          title="Go to home directory"
        >
          <Home size={14} />
        </button>
      </div>

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

      <div class="hairline-t bg-[color:var(--color-bg)]/95 backdrop-blur-md p-2">
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


function Breadcrumb(props: {
  path: string | undefined;
  home: string | undefined;
  onJump: (path: string) => void;
}) {
  const segments = () => {
    const p = props.path;
    const h = props.home;
    if (!p) return [];
    let display = p;
    let basePath = "/";
    if (h && (p === h || p.startsWith(h + "/"))) {
      display = p === h ? "~" : `~${p.slice(h.length)}`;
      basePath = h;
    }
    const parts = display.split("/").filter(Boolean);
    if (display.startsWith("~")) {
      return parts.map((name, i) => ({
        name,
        path:
          i === 0
            ? basePath
            : `${basePath}/${parts.slice(1, i + 1).join("/")}`,
      }));
    }
    return parts.map((name, i) => ({
      name,
      path: `/${parts.slice(0, i + 1).join("/")}`,
    }));
  };

  return (
    <div class="min-w-0 flex-1 overflow-x-auto">
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
