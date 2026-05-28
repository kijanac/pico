import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Check, ChevronLeft, Info, ListTree, Loader2, MoreHorizontal, Settings, X, Zap } from "lucide-solid";
import type { AuthLoginJob, AuthProvider, ModelSummary, QueueMode, SessionSettings, ThinkingLevel, TreeEntry } from "@pi-mobile/protocol";
import {
  cancelAuthLogin,
  compactSession,
  getAuthLoginJob,
  getSessionSettings,
  getSessionStats,
  getSessionTree,
  listAuthProviders,
  listSessionModels,
  navigateSessionTree,
  patchSessionSettings,
  setSessionModel,
  startAuthLogin,
  submitAuthLoginInput,
} from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";
import { haptic } from "~/lib/haptics";

type View = "menu" | "models" | "compact" | "settings" | "tree" | "info" | "auth";

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
                  {view() === "models"
                    ? "model"
                    : view() === "compact"
                      ? "compact context"
                      : view() === "settings"
                        ? "session settings"
                        : view() === "tree"
                          ? "tree"
                          : view() === "auth"
                            ? "provider sign-in"
                            : view() === "info"
                              ? "session info"
                              : "agent"}
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
                  onSettings={() => setView("settings")}
                  onTree={() => setView("tree")}
                  onInfo={() => setView("info")}
                  onAuth={() => setView("auth")}
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
              <Show when={view() === "settings"}>
                <SettingsView sessionId={props.sessionId} onError={(e) => setError(e)} />
              </Show>
              <Show when={view() === "tree"}>
                <TreeView
                  sessionId={props.sessionId}
                  onDone={() => {
                    haptic.success();
                    close();
                  }}
                  onError={(e) => setError(e)}
                />
              </Show>
              <Show when={view() === "info"}>
                <InfoView sessionId={props.sessionId} />
              </Show>
              <Show when={view() === "auth"}>
                <AuthView sessionId={props.sessionId} onError={(e) => setError(e)} />
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
  onSettings: () => void;
  onTree: () => void;
  onInfo: () => void;
  onAuth: () => void;
}): JSX.Element {
  return (
    <div class="space-y-2 px-3 py-3">
      <MenuButton title="provider sign-in" description="configure model provider auth from the phone" onClick={props.onAuth} />
      <MenuButton title="model" description="choose the model for this session" onClick={props.onModels} />
      <MenuButton title="compact context" description="summarize older context for future turns" onClick={props.onCompact} />
      <MenuButton title="tree" description="jump to an earlier node in this conversation" onClick={props.onTree} icon={<ListTree size={13} />} />
      <MenuButton title="session settings" description="thinking, queueing, compaction, and retry behavior" onClick={props.onSettings} icon={<Settings size={13} />} />
      <MenuButton title="session info" description="file, tokens, cost, and message counts" onClick={props.onInfo} icon={<Info size={13} />} />
    </div>
  );
}

function MenuButton(props: { title: string; description: string; onClick: () => void; icon?: JSX.Element }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="hairline-b flex w-full items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)]"
    >
      <Show when={props.icon}><span class="mt-0.5 text-[color:var(--color-fg-muted)]">{props.icon}</span></Show>
      <span class="min-w-0 flex-1">
        <span class="block text-[12.5px] font-medium">{props.title}</span>
        <span class="block text-[11px] text-[color:var(--color-fg-muted)]">{props.description}</span>
      </span>
    </button>
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

function AuthView(props: { sessionId: string; onError: (message: string) => void }): JSX.Element {
  const [job, setJob] = createSignal<AuthLoginJob | null>(null);
  const [input, setInput] = createSignal("");
  const [starting, setStarting] = createSignal<string | null>(null);
  const [providers, { refetch }] = createResource(async () => {
    const baseUrl = await getBridgeUrl();
    return listAuthProviders(baseUrl, props.sessionId);
  });

  async function start(provider: AuthProvider) {
    if (starting()) return;
    setStarting(provider.id);
    props.onError("");
    try {
      const baseUrl = await getBridgeUrl();
      setJob(await startAuthLogin(baseUrl, props.sessionId, provider.id));
    } catch (e) {
      props.onError(String(e));
    } finally {
      setStarting(null);
    }
  }

  async function refreshJob() {
    const j = job();
    if (!j) return;
    const baseUrl = await getBridgeUrl();
    const next = await getAuthLoginJob(baseUrl, props.sessionId, j.id);
    setJob(next);
    if (next.status === "success") {
      haptic.success();
      await refetch();
    }
  }

  let interval: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    const j = job();
    if (interval) clearInterval(interval);
    if (j && !["success", "failed", "cancelled", "prompt", "manual"].includes(j.status)) {
      interval = setInterval(() => void refreshJob(), 1200);
    }
  });

  async function submit() {
    const j = job();
    if (!j) return;
    const baseUrl = await getBridgeUrl();
    setJob(await submitAuthLoginInput(baseUrl, props.sessionId, j.id, input()));
    setInput("");
  }

  async function cancel() {
    const j = job();
    if (!j) return;
    const baseUrl = await getBridgeUrl();
    await cancelAuthLogin(baseUrl, props.sessionId, j.id);
    setJob(null);
  }

  return (
    <div class="flex-1 overflow-y-auto px-3 py-3">
      <Show when={!job()}>
        <div class="space-y-2">
          <Show when={providers.loading}><div class="text-[12px] text-[color:var(--color-fg-faint)]">loading providers…</div></Show>
          <For each={providers()?.providers ?? []}>
            {(provider) => (
              <button
                type="button"
                onClick={() => start(provider)}
                disabled={starting() !== null}
                class="hairline-b flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)] disabled:opacity-70"
              >
                <span class="min-w-0 flex-1">
                  <span class="block text-[12.5px] font-medium">{provider.name}</span>
                  <span class="block text-[11px] text-[color:var(--color-fg-muted)]">
                    {provider.configured ? `configured${provider.source ? ` via ${provider.source}` : ""}` : "not configured"}
                  </span>
                </span>
                <Show when={provider.configured}><Check size={14} class="text-[color:var(--color-accent)]" /></Show>
                <Show when={starting() === provider.id}><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /></Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={job()}>
        {(j) => (
          <div class="space-y-3 text-[12px]">
            <InfoRow label="provider" value={j().providerName ?? j().providerId} />
            <InfoRow label="status" value={j().status} />
            <Show when={j().authUrl}>
              <a class="block rounded-[var(--radius-md)] bg-[color:var(--color-accent)] px-3 py-3 text-center font-medium text-[color:var(--color-bg)]" href={j().authUrl} target="_blank" rel="noreferrer">
                open sign-in page
              </a>
            </Show>
            <Show when={j().verificationUri}>
              <a class="block rounded-[var(--radius-md)] bg-[color:var(--color-accent)] px-3 py-3 text-center font-medium text-[color:var(--color-bg)]" href={j().verificationUri} target="_blank" rel="noreferrer">
                open verification page
              </a>
            </Show>
            <Show when={j().userCode}><InfoRow label="device code" value={j().userCode ?? ""} /></Show>
            <Show when={j().instructions}><p class="text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">{j().instructions}</p></Show>
            <Show when={j().progress}><p class="text-[11px] text-[color:var(--color-fg-muted)]">{j().progress}</p></Show>
            <Show when={j().error}><p class="text-[11px] text-[color:var(--color-danger)]">{j().error}</p></Show>
            <Show when={j().status === "prompt" || j().status === "manual"}>
              <label class="block">
                <div class="label mb-1.5">{j().promptMessage ?? "input"}</div>
                <textarea rows="3" value={input()} onInput={(e) => setInput(e.currentTarget.value)} placeholder={j().promptPlaceholder ?? "paste code or redirect URL"} class="w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[12px]" />
              </label>
              <button type="button" onClick={submit} class="flex h-10 w-full items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--color-accent)] text-[12px] font-medium text-[color:var(--color-bg)]">submit</button>
            </Show>
            <button type="button" onClick={refreshJob} class="h-9 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] text-[12px]">refresh</button>
            <button type="button" onClick={cancel} class="h-9 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] text-[12px] text-[color:var(--color-fg-muted)]">cancel</button>
          </div>
        )}
      </Show>
    </div>
  );
}

function SettingsView(props: { sessionId: string; onError: (message: string) => void }): JSX.Element {
  const [saving, setSaving] = createSignal<string | null>(null);
  const [settings, { refetch, mutate }] = createResource(async () => {
    const baseUrl = await getBridgeUrl();
    return getSessionSettings(baseUrl, props.sessionId);
  });

  async function patch(key: keyof SessionSettings, value: ThinkingLevel | QueueMode | boolean) {
    if (saving()) return;
    setSaving(String(key));
    props.onError("");
    try {
      const baseUrl = await getBridgeUrl();
      const next = await patchSessionSettings(baseUrl, props.sessionId, { [key]: value });
      mutate(next);
      haptic.success();
    } catch (e) {
      props.onError(String(e));
      await refetch();
    } finally {
      setSaving(null);
    }
  }

  return (
    <div class="flex-1 overflow-y-auto px-3 py-3">
      <Show when={settings.loading}><div class="text-[12px] text-[color:var(--color-fg-faint)]">loading settings…</div></Show>
      <Show when={settings()}>
        {(s) => (
          <div class="space-y-4">
            <Segmented
              label="thinking level"
              options={s().availableThinkingLevels.length ? s().availableThinkingLevels : ["off", "low", "medium", "high"]}
              value={s().thinkingLevel}
              disabled={saving() !== null}
              onChange={(v) => patch("thinkingLevel", v as ThinkingLevel)}
            />
            <Segmented
              label="steering while running"
              options={["one-at-a-time", "all"]}
              value={s().steeringMode}
              disabled={saving() !== null}
              onChange={(v) => patch("steeringMode", v as QueueMode)}
            />
            <Segmented
              label="follow-up delivery"
              options={["one-at-a-time", "all"]}
              value={s().followUpMode}
              disabled={saving() !== null}
              onChange={(v) => patch("followUpMode", v as QueueMode)}
            />
            <ToggleRow label="auto compact" checked={s().autoCompaction} disabled={saving() !== null} onChange={(v) => patch("autoCompaction", v)} />
            <ToggleRow label="auto retry" checked={s().autoRetry} disabled={saving() !== null} onChange={(v) => patch("autoRetry", v)} />
          </div>
        )}
      </Show>
    </div>
  );
}

function Segmented(props: { label: string; options: string[]; value: string; disabled: boolean; onChange: (value: string) => void }): JSX.Element {
  return (
    <div>
      <div class="label mb-1.5">{props.label}</div>
      <div class="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-1">
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              disabled={props.disabled || option === props.value}
              onClick={() => props.onChange(option)}
              class={option === props.value
                ? "rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] px-2 py-2 text-[11px] font-medium text-[color:var(--color-bg)]"
                : "rounded-[var(--radius-sm)] px-2 py-2 text-[11px] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)] disabled:opacity-70"}
            >
              {option}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function ToggleRow(props: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      class="flex w-full items-center justify-between rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)] disabled:opacity-70"
    >
      <span class="text-[12.5px] font-medium">{props.label}</span>
      <span class={props.checked ? "text-[12px] text-[color:var(--color-accent)]" : "text-[12px] text-[color:var(--color-fg-faint)]"}>
        {props.checked ? "on" : "off"}
      </span>
    </button>
  );
}

function InfoView(props: { sessionId: string }): JSX.Element {
  const [stats] = createResource(async () => {
    const baseUrl = await getBridgeUrl();
    return getSessionStats(baseUrl, props.sessionId);
  });
  return (
    <div class="flex-1 overflow-y-auto px-3 py-3">
      <Show when={stats.loading}><div class="text-[12px] text-[color:var(--color-fg-faint)]">loading session info…</div></Show>
      <Show when={stats()}>
        {(s) => (
          <div class="space-y-2 text-[12px]">
            <InfoRow label="session id" value={s().sessionId} />
            <InfoRow label="file" value={s().sessionFile ?? "ephemeral"} />
            <InfoRow label="messages" value={String(s().totalMessages)} />
            <InfoRow label="user / assistant" value={`${s().userMessages} / ${s().assistantMessages}`} />
            <InfoRow label="tools" value={`${s().toolCalls} calls · ${s().toolResults} results`} />
            <InfoRow label="tokens" value={`${s().tokens.total} total · ${s().tokens.input} in · ${s().tokens.output} out`} />
            <InfoRow label="cost" value={`$${s().cost.toFixed(4)}`} />
          </div>
        )}
      </Show>
    </div>
  );
}

function InfoRow(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2">
      <div class="label">{props.label}</div>
      <div class="mt-1 break-words text-[12px] text-[color:var(--color-fg)]">{props.value}</div>
    </div>
  );
}

function TreeView(props: { sessionId: string; onDone: () => void; onError: (message: string) => void }): JSX.Element {
  const [jumping, setJumping] = createSignal<string | null>(null);
  const [summarize, setSummarize] = createSignal(false);
  const [tree, { refetch }] = createResource(async () => {
    const baseUrl = await getBridgeUrl();
    return getSessionTree(baseUrl, props.sessionId);
  });

  async function jump(entry: TreeEntry) {
    if (jumping() || entry.current) return;
    setJumping(entry.id);
    props.onError("");
    try {
      const baseUrl = await getBridgeUrl();
      await navigateSessionTree(baseUrl, props.sessionId, { entryId: entry.id, summarize: summarize() });
      props.onDone();
    } catch (e) {
      props.onError(String(e));
      await refetch();
    } finally {
      setJumping(null);
    }
  }

  return (
    <div class="flex-1 overflow-y-auto py-2">
      <div class="px-3 pb-2">
        <ToggleRow label="summarize abandoned branch" checked={summarize()} disabled={jumping() !== null} onChange={setSummarize} />
      </div>
      <Show when={tree.loading}><div class="px-3 py-3 text-[12px] text-[color:var(--color-fg-faint)]">loading tree…</div></Show>
      <Show when={(tree()?.entries.length ?? 0) === 0 && !tree.loading}>
        <div class="px-3 py-6 text-center text-[12px] text-[color:var(--color-fg-faint)]">no persisted tree entries yet</div>
      </Show>
      <For each={tree()?.entries ?? []}>
        {(entry) => (
          <button
            type="button"
            onClick={() => jump(entry)}
            disabled={jumping() !== null || entry.current}
            class="hairline-b flex w-full items-start gap-2 px-3 py-2 text-left active:bg-[color:var(--color-surface)] disabled:opacity-75"
          >
            <span class="pt-0.5 font-mono text-[10px] text-[color:var(--color-fg-faint)]" style={{ width: `${Math.max(0, entry.depth) * 12 + 12}px` }}>
              {entry.childCount > 1 ? "├" : "│"}
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">
                <span>{entry.role ?? entry.type}</span>
                <Show when={entry.current}><span class="text-[color:var(--color-accent)]">current</span></Show>
                <Show when={entry.onCurrentPath && !entry.current}><span>path</span></Show>
              </span>
              <span class="mt-0.5 line-clamp-2 block text-[12.5px] text-[color:var(--color-fg)]">
                {entry.label ? `${entry.label}: ` : ""}{entry.text || "—"}
              </span>
            </span>
            <Show when={jumping() === entry.id}>
              <Loader2 size={14} class="mt-1 text-[color:var(--color-fg-muted)]" style={{ animation: "spin 1s linear infinite" }} />
            </Show>
          </button>
        )}
      </For>
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
