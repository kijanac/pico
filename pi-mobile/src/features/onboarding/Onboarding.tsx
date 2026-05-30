import { A } from "@solidjs/router";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-solid";
import { renderBridgeCloudInit } from "@pi-mobile/protocol";
import EdgeSwipeBack from "@/components/EdgeSwipeBack";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel";
import { TextField, TextFieldInput, TextFieldLabel, TextFieldTextArea } from "@/components/ui/text-field";
import AuthView from "@/features/chat/actions/AuthView";
import SessionsPreview from "@/features/sessions/components/SessionsPreview";
import { claimBridge, getBridgeIdentity, healthcheck } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { KeyboardAvoidance } from "@/lib/keyboard";
import { clearOnboardingDraft, getOnboardingDraft, setBridgeUrl, setOnboardingDraft, type OnboardingDraft } from "@/lib/settings";

const steps = ["tailscale", "keys", "cloud-init", "connect", "providers", "done"] as const;
type ConnectState = "idle" | "polling" | "reachable" | "claimed" | "failed";

function randomBridgeHostname(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return `pi-bridge-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeTailnet(value: string): string {
  return value.trim().replace(/^https?:\/\//, "").replace(/^\.+/, "").replace(/\/+$/, "").toLowerCase();
}

function setupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("missing_tailscale_identity")) return "Tailscale identity missing. Connect Tailscale on this phone and try again.";
  if (message.includes("tailscale_user_not_bridge_owner")) return "This bridge is claimed by another Tailscale user.";
  if (message.includes("bridge is already claimed")) return "This bridge is already claimed.";
  return "Bridge is reachable, but claim failed. Check Tailscale and try again.";
}

export default function Onboarding() {
  const [draft] = createResource(getOnboardingDraft);

  return (
    <Show when={draft()} fallback={<div class="p-4 text-[12px] text-[color:var(--color-fg-muted)]">loading onboarding…</div>}>
      {(loadedDraft) => <OnboardingContent draft={loadedDraft()} />}
    </Show>
  );
}

function OnboardingContent(props: { draft: Partial<OnboardingDraft> }) {
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [carouselApi, setCarouselApi] = createSignal<ReturnType<CarouselApi>>();
  const [tsAuthKey, setTsAuthKey] = createSignal(props.draft.tsAuthKey ?? "");
  const [tailnet, setTailnet] = createSignal(props.draft.tailnet ?? "");
  const [bridgeHostname, setBridgeHostname] = createSignal(props.draft.bridgeHostname ?? randomBridgeHostname());
  const [showAdvanced, setShowAdvanced] = createSignal(false);
  const [copied, setCopied] = createSignal<string | null>(null);
  const [connectState, setConnectState] = createSignal<ConnectState>("idle");
  const [connectMessage, setConnectMessage] = createSignal("Paste the cloud-init into your provider, boot the box, then start waiting here.");
  const [authError, setAuthError] = createSignal<string | null>(null);
  const [providerConfigured, setProviderConfigured] = createSignal(false);

  const tailnetDns = createMemo(() => normalizeTailnet(tailnet()));
  const bridgeUrl = createMemo(() => {
    const host = bridgeHostname().trim().toLowerCase();
    const suffix = tailnetDns();
    return host && suffix ? `https://${host}.${suffix}` : "";
  });
  const cloudInit = createMemo(() => renderBridgeCloudInit({ tsAuthKey: tsAuthKey(), bridgeHostname: bridgeHostname() }));
  const hasSetupInputs = createMemo(() => tsAuthKey().trim().startsWith("tskey-auth-") && tailnetDns().endsWith(".ts.net"));
  const maxAllowedIndex = createMemo(() => {
    if (providerConfigured()) return 5;
    if (connectState() === "claimed") return 4;
    if (hasSetupInputs()) return 3;
    return 1;
  });

  createEffect(() => {
    void setOnboardingDraft({
      tsAuthKey: tsAuthKey(),
      tailnet: tailnet(),
      bridgeHostname: bridgeHostname(),
    });
  });

  createEffect(() => {
    carouselApi()?.scrollTo(currentIndex());
  });

  createEffect(() => {
    const api = carouselApi();
    if (!api) return;

    const onSelect = () => {
      const selected = api.selectedScrollSnap();
      const allowed = maxAllowedIndex();
      if (selected > allowed) {
        api.scrollTo(currentIndex());
        return;
      }
      setCurrentIndex(selected);
    };

    api.on("select", onSelect);
    onCleanup(() => api.off("select", onSelect));
  });

  function go(index: number) {
    setCurrentIndex(Math.min(index, maxAllowedIndex()));
  }

  function back() {
    setCurrentIndex(Math.max(0, currentIndex() - 1));
  }

  function next() {
    setCurrentIndex(Math.min(maxAllowedIndex(), currentIndex() + 1));
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  }

  async function waitForBridge() {
    const url = bridgeUrl();
    if (!url || connectState() === "polling") return;
    setConnectState("polling");
    setConnectMessage("Waiting for the bridge HTTPS endpoint to come online. This can take a few minutes on first boot…");

    for (let attempt = 1; attempt <= 60; attempt += 1) {
      if (await healthcheck(url)) {
        setConnectState("reachable");
        setConnectMessage("Bridge is reachable. Saving URL and claiming it with your Tailscale identity…");
        await setBridgeUrl(url);
        try {
          const identity = await getBridgeIdentity(url);
          if (!identity.claimed) await claimBridge(url);
          setConnectState("claimed");
          setConnectMessage("Bridge connected and claimed. You’re ready to continue.");
          await clearOnboardingDraft();
          haptic.success();
          setCurrentIndex(4);
        } catch (error) {
          setConnectState("failed");
          setConnectMessage(setupErrorMessage(error));
        }
        return;
      }
      setConnectMessage(`Still waiting for ${url}… (${attempt}/60)`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    setConnectState("failed");
    setConnectMessage("Timed out. Check VPS cloud-init logs and make sure Tailscale is connected on this phone.");
  }

  return (
    <EdgeSwipeBack href="/settings" preview={<SessionsPreview />}>
      <KeyboardAvoidance mode="manual">
        <Header back="/settings" title="bridge onboarding" />
        <div class="flex min-h-0 flex-1 flex-col px-3 pt-4" style={{ "padding-bottom": "calc(env(safe-area-inset-bottom) + 1rem)" }}>
          <div class="mb-4 flex items-center gap-1.5">
            <For each={steps}>
              {(_, i) => (
                <button
                  type="button"
                  onClick={() => go(i())}
                  class={`h-1.5 flex-1 rounded-full ${i() <= currentIndex() ? "bg-[color:var(--color-accent)]" : "bg-[color:var(--color-border)]"}`}
                  aria-label={`Go to step ${i() + 1}`}
                />
              )}
            </For>
          </div>

          <Carousel
            setApi={(api) => setCarouselApi(api())}
            opts={{ align: "start", containScroll: "trimSnaps" }}
            class="min-h-0 flex-1"
          >
            <CarouselContent class="h-full -ml-3">
              <CarouselItem class="min-h-0 overflow-y-auto pl-3">
                <Panel title="before you start" eyebrow="step 1">
                  <p class="text-[12px] leading-relaxed text-[color:var(--color-fg-muted)]">
                    pi-mobile will generate cloud-init for a fresh Linux box. The box will install pi-bridge, join your Tailscale tailnet, and expose HTTPS through Tailscale Serve.
                  </p>
                  <Checklist items={["Tailscale is installed and signed in on this phone", "You can create a VPS with cloud-init/user-data", "You can access Tailscale admin in a browser"]} />
                  <LinkButton href="https://login.tailscale.com/admin/settings/keys">open Tailscale admin</LinkButton>
                </Panel>
              </CarouselItem>

              <CarouselItem class="min-h-0 overflow-y-auto pl-3">
                <Panel title="tailscale setup" eyebrow="step 2">
                  <p class="text-[12px] leading-relaxed text-[color:var(--color-fg-muted)]">
                    Create a single-use, preauthorized auth key, then copy your tailnet DNS name from the DNS page. The bridge hostname is generated for you.
                  </p>
                  <div class="grid grid-cols-2 gap-2">
                    <LinkButton href="https://login.tailscale.com/admin/settings/keys">keys</LinkButton>
                    <LinkButton href="https://login.tailscale.com/admin/dns">dns</LinkButton>
                  </div>
                  <div class="space-y-3">
                    <Field id="ts_auth_key" label="tailscale auth key" value={tsAuthKey()} onInput={setTsAuthKey} placeholder="tskey-auth-..." secret />
                    <Field id="tailnet" label="tailnet DNS name" value={tailnet()} onInput={setTailnet} placeholder="tailabc123.ts.net" />
                  </div>
                  <button type="button" onClick={() => setShowAdvanced(!showAdvanced())} class="text-left text-[11px] text-[color:var(--color-accent)] active:opacity-70">
                    {showAdvanced() ? "hide" : "show"} advanced hostname
                  </button>
                  <Show when={showAdvanced()}>
                    <Field id="bridge_hostname" label="bridge hostname" value={bridgeHostname()} onInput={setBridgeHostname} placeholder="pi-bridge-ab12cd" />
                  </Show>
                  <Show when={bridgeUrl()}>
                    <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[11px] text-[color:var(--color-fg-muted)]">
                      Bridge URL will be <span class="text-[color:var(--color-fg)]">{bridgeUrl()}</span>
                    </div>
                  </Show>
                </Panel>
              </CarouselItem>

              <CarouselItem class="min-h-0 overflow-y-auto pl-3">
                <Panel title="copy cloud-init" eyebrow="step 3">
                  <p class="text-[12px] leading-relaxed text-[color:var(--color-fg-muted)]">
                    Paste this into your cloud provider’s user-data/cloud-init field when creating the VPS. Use a fresh box.
                  </p>
                  <TextField>
                    <TextFieldLabel for="cloud_init">cloud-init</TextFieldLabel>
                    <TextFieldTextArea id="cloud_init" readonly value={cloudInit()} rows={15} class="min-h-0 resize-none bg-[color:var(--color-bg)] font-mono text-[10.5px] leading-relaxed" />
                  </TextField>
                  <Button type="button" variant="outline" onClick={() => copy(cloudInit(), "cloud-init")} class="w-full border-[color:var(--color-border-strong)] active:bg-[color:var(--color-bg)]">
                    <Copy size={14} /> {copied() === "cloud-init" ? "copied ✓" : "copy cloud-init"}
                  </Button>
                </Panel>
              </CarouselItem>

              <CarouselItem class="min-h-0 overflow-y-auto pl-3">
                <Panel title="wait for bridge" eyebrow="step 4">
                  <p class="text-[12px] leading-relaxed text-[color:var(--color-fg-muted)]">
                    After the VPS starts, pi-mobile will poll the Tailscale HTTPS URL. Keep the Tailscale app connected on this phone.
                  </p>
                  <Info label="bridge url" value={bridgeUrl()} />
                  <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-[12px] leading-relaxed text-[color:var(--color-fg-muted)]">
                    <div class="mb-1 flex items-center gap-2 text-[color:var(--color-fg)]">
                      <Show when={connectState() === "polling"}><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /></Show>
                      <Show when={connectState() === "claimed"}><Check size={14} class="text-[color:var(--color-accent)]" /></Show>
                      <span>{connectState()}</span>
                    </div>
                    {connectMessage()}
                  </div>
                  <Button type="button" variant="default" disabled={!bridgeUrl() || connectState() === "polling"} onClick={waitForBridge} class="w-full bg-[color:var(--color-accent)] text-[color:var(--color-bg)] hover:bg-[color:var(--color-accent)] active:opacity-80">
                    {connectState() === "polling" ? "waiting…" : "wait for bridge"}
                  </Button>
                </Panel>
              </CarouselItem>

              <CarouselItem class="min-h-0 overflow-y-auto pl-3">
                <Panel title="provider sign-in" eyebrow="step 5">
                  <p class="text-[12px] leading-relaxed text-[color:var(--color-fg-muted)]">
                    Sign in to at least one provider so new sessions can use a model.
                  </p>
                  <Show when={authError()}>
                    <p class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[11px] text-[color:var(--color-danger)]">{authError()}</p>
                  </Show>
                  <AuthView onError={setAuthError} onConfigured={() => setProviderConfigured(true)} />
                </Panel>
              </CarouselItem>

              <CarouselItem class="min-h-0 overflow-y-auto pl-3">
                <Panel title="bridge ready" eyebrow="done">
                  <div class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 text-center">
                    <Check class="mx-auto mb-2 text-[color:var(--color-accent)]" size={24} />
                    <p class="text-[13px] font-medium">pi-mobile is connected to your bridge.</p>
                    <p class="mt-1 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">Provider sign-in is available from a session’s action menu when you’re ready.</p>
                  </div>
                  <A href="/" class="block rounded-[var(--radius-md)] bg-[color:var(--color-accent)] px-3 py-3 text-center text-[13px] font-medium text-[color:var(--color-bg)] active:opacity-80">go to sessions</A>
                </Panel>
              </CarouselItem>
            </CarouselContent>
          </Carousel>

          <div class="mt-4 flex items-center gap-2">
            <Button type="button" variant="outline" onClick={back} disabled={currentIndex() === 0} class="flex-1 border-[color:var(--color-border-strong)] active:bg-[color:var(--color-bg)]">back</Button>
            <Button type="button" variant="default" onClick={next} disabled={currentIndex() >= maxAllowedIndex() || currentIndex() === steps.length - 1} class="flex-1 bg-[color:var(--color-accent)] text-[color:var(--color-bg)] hover:bg-[color:var(--color-accent)] active:opacity-80">next</Button>
          </div>
        </div>
      </KeyboardAvoidance>
    </EdgeSwipeBack>
  );
}

function Panel(props: { eyebrow: string; title: string; children: import("solid-js").JSX.Element }) {
  return (
    <section class="space-y-4 rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
      <div>
        <div class="label mb-1">{props.eyebrow}</div>
        <h2 class="text-[18px] font-semibold tracking-tight text-[color:var(--color-fg)]">{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
}

function Checklist(props: { items: string[] }) {
  return (
    <ul class="space-y-2">
      <For each={props.items}>{(item) => <li class="flex gap-2 text-[12px] text-[color:var(--color-fg-muted)]"><Check size={14} class="mt-0.5 text-[color:var(--color-accent)]" /> <span>{item}</span></li>}</For>
    </ul>
  );
}

function LinkButton(props: { href: string; children: import("solid-js").JSX.Element }) {
  return <a href={props.href} target="_blank" rel="noreferrer" class="flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-strong)] text-[12px] active:bg-[color:var(--color-bg)]">{props.children}<ExternalLink size={13} /></a>;
}

function Field(props: { id: string; label: string; value: string; onInput: (value: string) => void; placeholder: string; secret?: boolean }) {
  return (
    <TextField>
      <TextFieldLabel for={props.id}>{props.label}</TextFieldLabel>
      <TextFieldInput id={props.id} type={props.secret ? "password" : "text"} autocapitalize="none" autocorrect="off" spellcheck={false} value={props.value} onInput={(e) => props.onInput(e.currentTarget.value)} placeholder={props.placeholder} class="bg-[color:var(--color-bg)] text-[12px]" />
    </TextField>
  );
}

function Info(props: { label: string; value: string }) {
  return <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[11px]"><span class="label mr-2">{props.label}</span><span class="text-[color:var(--color-fg-muted)]">{props.value}</span></div>;
}
