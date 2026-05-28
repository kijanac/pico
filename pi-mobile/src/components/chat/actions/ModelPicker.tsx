import { For, Show, createMemo, createResource, createSignal, type JSX } from "solid-js";
import { Check, Loader2, Zap } from "lucide-solid";
import type { ModelSummary } from "@pi-mobile/protocol";
import { listSessionModels, setSessionModel } from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";
import { haptic } from "~/lib/haptics";
import type { ActionErrorHandler } from "./types";

export default function ModelPicker(props: { sessionId: string; onError: ActionErrorHandler }): JSX.Element {
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
    props.onError(null);
    try {
      const baseUrl = await getBridgeUrl();
      await setSessionModel(baseUrl, props.sessionId, { provider: model.provider, modelId: model.id });
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
      <Show when={models.loading}><div class="px-3 py-3 text-[12px] text-[color:var(--color-fg-faint)]">loading models…</div></Show>
      <Show when={models.error}><div class="px-3 py-3 text-[12px] text-[color:var(--color-danger)]">{String(models.error)}</div></Show>
      <Show when={(models()?.models.length ?? 0) > 0} fallback={<Show when={!models.loading && !models.error}><div class="px-3 py-6 text-center text-[12px] text-[color:var(--color-fg-faint)]">no authenticated models available</div></Show>}>
        <For each={groups()}>
          {([provider, list]) => (
            <div>
              <div class="sticky top-0 z-10 border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]/95 px-3 py-1 backdrop-blur-md"><span class="label">{provider}</span></div>
              <For each={list}>
                {(model) => {
                  const key = `${model.provider}/${model.id}`;
                  return (
                    <button type="button" onClick={() => choose(model)} disabled={setting() !== null || model.current} class="hairline-b flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-[color:var(--color-surface)] disabled:opacity-70">
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-[12.5px] text-[color:var(--color-fg)]">{model.name}</div>
                        <div class="mt-0.5 flex gap-2 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">
                          <span>{model.id}</span>
                          <Show when={model.reasoning}><span class="flex items-center gap-0.5"><Zap size={9} /> reasoning</span></Show>
                          <Show when={model.usingOAuth}><span>oauth</span></Show>
                        </div>
                      </div>
                      <Show when={setting() === key}><Loader2 size={14} class="text-[color:var(--color-fg-muted)]" style={{ animation: "spin 1s linear infinite" }} /></Show>
                      <Show when={model.current}><Check size={14} class="text-[color:var(--color-accent)]" /></Show>
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
