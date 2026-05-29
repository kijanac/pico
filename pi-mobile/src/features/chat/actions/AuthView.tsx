import { For, Show, createEffect, createResource, createSignal } from "solid-js";
import { Check, Loader2 } from "lucide-solid";
import type { AuthLoginJob, AuthProvider } from "@pi-mobile/protocol";
import { cancelAuthLogin, getAuthLoginJob, listAuthProviders, startAuthLogin, submitAuthLoginInput } from "@/lib/api";
import { getBridgeUrl } from "@/lib/settings";
import { haptic } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { TextField, TextFieldLabel, TextFieldTextArea } from "@/components/ui/text-field";
import { InfoRow } from "./shared";
import type { ActionErrorHandler } from "./types";

export default function AuthView(props: { sessionId: string; onError: ActionErrorHandler }) {
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
    props.onError(null);
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
              <button type="button" onClick={() => start(provider)} disabled={starting() !== null} class="hairline-b flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)] disabled:opacity-70">
                <span class="min-w-0 flex-1">
                  <span class="block text-[12.5px] font-medium">{provider.name}</span>
                  <span class="block text-[11px] text-[color:var(--color-fg-muted)]">{provider.configured ? `configured${provider.source ? ` via ${provider.source}` : ""}` : "not configured"}</span>
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
            <Show when={j().authUrl}><a class="block rounded-[var(--radius-md)] bg-[color:var(--color-accent)] px-3 py-3 text-center font-medium text-[color:var(--color-bg)]" href={j().authUrl} target="_blank" rel="noreferrer">open sign-in page</a></Show>
            <Show when={j().verificationUri}><a class="block rounded-[var(--radius-md)] bg-[color:var(--color-accent)] px-3 py-3 text-center font-medium text-[color:var(--color-bg)]" href={j().verificationUri} target="_blank" rel="noreferrer">open verification page</a></Show>
            <Show when={j().userCode}><InfoRow label="device code" value={j().userCode ?? ""} /></Show>
            <Show when={j().instructions}><p class="text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">{j().instructions}</p></Show>
            <Show when={j().progress}><p class="text-[11px] text-[color:var(--color-fg-muted)]">{j().progress}</p></Show>
            <Show when={j().error}><p class="text-[11px] text-[color:var(--color-danger)]">{j().error}</p></Show>
            <Show when={j().status === "prompt" || j().status === "manual"}>
              <TextField>
                <TextFieldLabel>{j().promptMessage ?? "input"}</TextFieldLabel>
                <TextFieldTextArea
                  rows="3"
                  value={input()}
                  onInput={(e) => setInput(e.currentTarget.value)}
                  placeholder={j().promptPlaceholder ?? "paste code or redirect URL"}
                  class="min-h-0 text-[12px]"
                />
              </TextField>
              <Button type="button" variant="default" onClick={submit} class="w-full bg-[color:var(--color-accent)] text-[color:var(--color-bg)] hover:bg-[color:var(--color-accent)] active:opacity-80">submit</Button>
            </Show>
            <button type="button" onClick={refreshJob} class="h-9 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] text-[12px]">refresh</button>
            <button type="button" onClick={cancel} class="h-9 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] text-[12px] text-[color:var(--color-fg-muted)]">cancel</button>
          </div>
        )}
      </Show>
    </div>
  );
}
