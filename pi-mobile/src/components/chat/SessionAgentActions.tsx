import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Check, ChevronLeft, Loader2, MoreHorizontal, X, Zap } from "lucide-solid";
import type { ModelSummary } from "@pi-mobile/protocol";
import {
  compactSession,
  listSessionModels,
  setSessionModel,
} from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";
import { haptic } from "~/lib/haptics";

type View = "menu" | "models" | "compact";

interface Props {
  sessionId: string;
}

export default function SessionAgentActions(props: Props): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [view, setView] = createSignal<View>("menu");
  const [error, setError] = createSignal<string | null>(null);

  function close() {
    setOpen(false);
    setView("menu");
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        class="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
        aria-label="Agent actions"
        title="Agent actions"
      >
        <MoreHorizontal size={16} />
      </button>

      <Show when={open()}>
        <Portal>
          <div
            class="fixed inset-0 z-[100] bg-[color:var(--color-bg)]/60 backdrop-blur-sm"
            onPointerDown={(e) => {
              if (e.currentTarget === e.target) close();
            }}
          >
            <div
              class="absolute inset-x-0 bottom-0 flex max-h-[86dvh] flex-col rounded-t-[12px] border-t border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]"
              style={{
                "padding-bottom": "calc(env(safe-area-inset-bottom) + 0.5rem)",
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div class="flex justify-center py-2">
                <div class="h-1 w-9 rounded-full bg-[color:var(--color-border-strong)]" />
              </div>

              <div class="hairline-b flex items-center gap-1 px-2 pb-2">
                <Show when={view() !== "menu"}>
                  <button
                    type="button"
                    onClick={() => {
                      setView("menu");
                      setError(null);
                    }}
                    class="flex h-9 w-9 items-center justify-center text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
                    aria-label="Back"
                  >
                    <ChevronLeft size={16} />
                  </button>
                </Show>
                <div class="min-w-0 flex-1 px-1 text-[13px] font-medium">
                  <Show when={view() === "models"} fallback={view() === "compact" ? "compact context" : "agent"}>
                    model
                  </Show>
                </div>
                <button
                  type="button"
                  onClick={close}
                  class="flex h-9 w-9 items-center justify-center text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>

              <Show when={error()}>
                <div class="mx-3 mt-3 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[11px] text-[color:var(--color-danger)]">
                  {error()}
                </div>
              </Show>

              <Show when={view() === "menu"}>
                <MenuView
                  onModels={() => setView("models")}
                  onCompact={() => setView("compact")}
                />
              </Show>
              <Show when={view() === "models"}>
                <ModelView
                  sessionId={props.sessionId}
                  onError={(e) => setError(e)}
                />
              </Show>
              <Show when={view() === "compact"}>
                <CompactView
                  sessionId={props.sessionId}
                  onDone={() => {
                    haptic.success();
                    close();
                  }}
                  onError={(e) => setError(e)}
                />
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}

function MenuView(props: {
  onModels: () => void;
  onCompact: () => void;
}): JSX.Element {
  return (
    <div class="space-y-2 px-3 py-3">
      <button
        type="button"
        onClick={props.onModels}
        class="hairline-b flex w-full flex-col items-start gap-0.5 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)]"
      >
        <span class="text-[12.5px] font-medium">model</span>
        <span class="text-[11px] text-[color:var(--color-fg-muted)]">
          choose the model for this session
        </span>
      </button>
      <button
        type="button"
        onClick={props.onCompact}
        class="hairline-b flex w-full flex-col items-start gap-0.5 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)]"
      >
        <span class="text-[12.5px] font-medium">compact context</span>
        <span class="text-[11px] text-[color:var(--color-fg-muted)]">
          summarize older context for future turns
        </span>
      </button>
    </div>
  );
}

function ModelView(props: {
  sessionId: string;
  onError: (message: string) => void;
}): JSX.Element {
  const [setting, setSetting] = createSignal<string | null>(null);
  const [models, { refetch }] = createResource(async () => {
    const baseUrl = await getBridgeUrl();
    return listSessionModels(baseUrl, props.sessionId);
  });

  const groups = createMemo(() => {
    const map = new Map<string, ModelSummary[]>();
    for (const model of models()?.models ?? []) {
      const list = map.get(model.provider) ?? [];
      list.push(model);
      map.set(model.provider, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  async function choose(model: ModelSummary) {
    if (setting()) return;
    setSetting(`${model.provider}/${model.id}`);
    props.onError("");
    try {
      const baseUrl = await getBridgeUrl();
      await setSessionModel(baseUrl, props.sessionId, {
        provider: model.provider,
        modelId: model.id,
      });
      haptic.success();
      await refetch();
    } catch (e) {
      props.onError(String(e));
    } finally {
      setSetting(null);
    }
  }

  return (
    <div class="flex-1 overflow-y-auto py-2">
      <Show when={models.loading}>
        <div class="px-3 py-3 text-[12px] text-[color:var(--color-fg-faint)]">
          loading models…
        </div>
      </Show>
      <Show when={models.error}>
        <div class="px-3 py-3 text-[12px] text-[color:var(--color-danger)]">
          {String(models.error)}
        </div>
      </Show>
      <Show
        when={(models()?.models.length ?? 0) > 0}
        fallback={
          <Show when={!models.loading && !models.error}>
            <div class="px-3 py-6 text-center text-[12px] text-[color:var(--color-fg-faint)]">
              no authenticated models available
            </div>
          </Show>
        }
      >
        <For each={groups()}>
          {([provider, list]) => (
            <div>
              <div class="sticky top-0 z-10 border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]/95 px-3 py-1 backdrop-blur-md">
                <span class="label">{provider}</span>
              </div>
              <For each={list}>
                {(model) => {
                  const key = `${model.provider}/${model.id}`;
                  return (
                    <button
                      type="button"
                      onClick={() => choose(model)}
                      disabled={setting() !== null || model.current}
                      class="hairline-b flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-[color:var(--color-surface)] disabled:opacity-70"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-[12.5px] text-[color:var(--color-fg)]">
                          {model.name}
                        </div>
                        <div class="mt-0.5 flex gap-2 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">
                          <span>{model.id}</span>
                          <Show when={model.reasoning}>
                            <span class="flex items-center gap-0.5">
                              <Zap size={9} /> reasoning
                            </span>
                          </Show>
                          <Show when={model.usingOAuth}>
                            <span>oauth</span>
                          </Show>
                        </div>
                      </div>
                      <Show when={setting() === key}>
                        <Loader2
                          size={14}
                          class="text-[color:var(--color-fg-muted)]"
                          style={{ animation: "spin 1s linear infinite" }}
                        />
                      </Show>
                      <Show when={model.current}>
                        <Check size={14} class="text-[color:var(--color-accent)]" />
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

function CompactView(props: {
  sessionId: string;
  onDone: () => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [instructions, setInstructions] = createSignal("");
  const [running, setRunning] = createSignal(false);

  async function compact() {
    if (running()) return;
    setRunning(true);
    props.onError("");
    try {
      const baseUrl = await getBridgeUrl();
      await compactSession(baseUrl, props.sessionId, instructions());
      props.onDone();
    } catch (e) {
      props.onError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div class="space-y-3 px-3 py-3">
      <p class="text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
        Compaction summarizes older context for future model turns. The full
        session history stays on disk, but future prompts use the compacted
        summary to save context.
      </p>
      <label class="block">
        <div class="label mb-1.5">optional instructions</div>
        <textarea
          value={instructions()}
          onInput={(e) => setInstructions(e.currentTarget.value)}
          rows="4"
          placeholder="Preserve decisions, TODOs, file paths, and open questions…"
          class="w-full resize-none rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[12.5px] text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-faint)] focus:border-[color:var(--color-border-strong)] focus:outline-none"
        />
      </label>
      <button
        type="button"
        onClick={compact}
        disabled={running()}
        class="flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--color-accent)] text-[12px] font-medium text-[color:var(--color-bg)] active:opacity-80 disabled:opacity-50"
      >
        <Show when={running()}>
          <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
        </Show>
        {running() ? "compacting…" : "compact now"}
      </button>
    </div>
  );
}
