<script lang="ts">
  import { onMount } from "svelte";
  import { ArrowRight, Check, Loader2, ScanLine } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { createOnboardingState, onboardingSteps } from "@/features/onboarding/onboarding.state.svelte";
  import Checklist from "@/features/onboarding/components/Checklist.svelte";
  import ExternalLinkButton from "@/features/onboarding/components/ExternalLinkButton.svelte";
  import OnboardingPanel from "@/features/onboarding/components/OnboardingPanel.svelte";
  import ProviderSignIn from "@/features/onboarding/components/ProviderSignIn.svelte";
  import SettingsField from "@/features/settings/components/SettingsField.svelte";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import HostIssuePanel from "@/shared/components/HostIssuePanel.svelte";
  import { scanQrCode } from "@/shared/mobile/barcode";
  import { Button } from "@/shared/ui/button";
  import { Carousel, CarouselContent, CarouselItem } from "@/shared/ui/carousel";

  const DEPLOY_DOCS_URL = "https://github.com/kijanac/pico/blob/main/packages/host/deploy/README.md";

  const onboarding = createOnboardingState();

  let manualUrl = $state("");
  let scanError = $state(false);

  onMount(() => {
    if (!settingsState.loaded) void settingsState.load();
  });

  $effect(() => {
    onboarding.syncCarouselToIndex();
  });

  $effect(() => onboarding.bindCarouselSelection());

  function normalizeCandidate(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  // Scanned QR is a pico://connect?url=…&claim=… link; claim inline and advance.
  async function scanToConnect(): Promise<void> {
    scanError = false;
    const scanned = await scanQrCode();
    if (!scanned) return; // cancelled
    try {
      const parsed = new URL(scanned);
      const url = parsed.searchParams.get("url")?.trim();
      const token = parsed.searchParams.get("claim")?.trim() || parsed.searchParams.get("token")?.trim() || undefined;
      if (!url) {
        scanError = true;
        return;
      }
      await onboarding.connect(url, token);
    } catch {
      scanError = true;
    }
  }

  function connectManual(): void {
    const candidate = normalizeCandidate(manualUrl);
    if (candidate) void onboarding.connect(candidate);
  }

  async function skip(): Promise<void> {
    await settingsState.skipWelcome();
    navigateTo(routePaths.sessions, "replace");
  }
</script>

<main class="flex min-h-0 flex-1 flex-col px-3 pt-[calc(env(safe-area-inset-top)+12px)]" style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem)">
  <div class="mb-4 flex items-center gap-1.5">
    {#each onboardingSteps as _step, index}
      <button
        type="button"
        onclick={() => onboarding.go(index)}
        class={`h-1.5 flex-1 rounded-full ${index <= onboarding.currentIndex ? "bg-[color:var(--color-accent)]" : "bg-[color:var(--color-border)]"}`}
        aria-label={`Go to step ${index + 1}`}
      ></button>
    {/each}
  </div>

  <Carousel setApi={onboarding.setCarouselApi} opts={{ align: "start", containScroll: "trimSnaps" }} class="min-h-0 flex-1">
    <CarouselContent class="h-full -ml-3">
      <!-- step 1 — run your host -->
      <CarouselItem class="min-h-0 overflow-y-auto pl-3">
        <div class="space-y-5">
          <div>
            <h1 class="font-mono text-[32px] leading-none font-medium tracking-tight">
              pico<span class="animate-pulse text-[color:var(--color-accent)]">▍</span>
            </h1>
            <p class="type-copy mt-3 max-w-[34ch] text-[color:var(--color-fg-muted)]">
              pi runs on your machine. pico streams its sessions to your phone over your tailnet — no cloud in between.
            </p>
          </div>

          <div aria-hidden="true" class="flex items-center gap-2 select-none">
            <span class="type-label uppercase tracking-[0.08em] shrink-0 text-[color:var(--color-fg)]">this phone</span>
            <span class="h-px flex-1 bg-[color:var(--color-border-strong)]"></span>
            <span class="type-label uppercase tracking-[0.08em] shrink-0 text-[color:var(--color-fg-faint)]">tailnet</span>
            <span class="h-px flex-1 bg-[color:var(--color-border-strong)]"></span>
            <span class="type-label uppercase tracking-[0.08em] shrink-0 text-[color:var(--color-fg)]">your box</span>
            <span class="size-1.5 shrink-0 rounded-full bg-[color:var(--color-accent)]"></span>
          </div>

          <OnboardingPanel eyebrow="step 1" title="run your host">
            <p class="type-copy text-[color:var(--color-fg-muted)]">On the machine you want pi to run on:</p>
            <code class="block rounded-[var(--radius-md)] bg-[color:var(--color-bg)] px-3 py-2 font-mono text-[13px] text-[color:var(--color-fg)]">pico doctor && pico pair</code>
            <Checklist items={["installs and starts the Pico host", "joins your tailnet and serves it over HTTPS", "prints a QR code to pair this phone"]} />
            <ExternalLinkButton href={DEPLOY_DOCS_URL}>running on a server?</ExternalLinkButton>
          </OnboardingPanel>
        </div>
      </CarouselItem>

      <!-- step 2 — connect -->
      <CarouselItem class="min-h-0 overflow-y-auto pl-3">
        <OnboardingPanel eyebrow="step 2" title="connect">
          <p class="type-copy text-[color:var(--color-fg-muted)]">
            scan the QR that <code class="type-code">pico pair</code> printed — or enter the host URL by hand.
          </p>
          <Button type="button" class="h-11 w-full" disabled={onboarding.connecting} onclick={() => void scanToConnect()}>
            {#if onboarding.connecting}
              <Loader2 class="size-4 animate-spin" /> connecting…
            {:else}
              <ScanLine class="size-4" /> scan QR code
            {/if}
          </Button>
          {#if scanError}
            <p class="type-meta text-center text-[color:var(--color-danger)]">That QR isn’t a Pico pairing code.</p>
          {/if}

          <div class="space-y-2">
            <SettingsField
              id="host_url"
              label="host URL"
              value={manualUrl}
              onValue={(next) => (manualUrl = next)}
              placeholder="pico-host-ab12cd.tailabc123.ts.net"
            />
            {#if onboarding.connectIssue}
              <HostIssuePanel issue={onboarding.connectIssue} />
            {/if}
            <Button type="button" variant="outline" class="h-10 w-full" disabled={onboarding.connecting || !manualUrl.trim()} onclick={connectManual}>
              connect manually
            </Button>
          </div>
        </OnboardingPanel>
      </CarouselItem>

      <!-- step 3 — provider sign-in -->
      <CarouselItem class="min-h-0 overflow-y-auto pl-3">
        <OnboardingPanel eyebrow="step 3" title="sign in to a provider">
          <p class="type-copy text-[color:var(--color-fg-muted)]">
            connect a model provider so your sessions can think. you can also do this later from a session’s menu.
          </p>
          {#if onboarding.authError}
            <p class="type-meta rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[color:var(--color-danger)]">{onboarding.authError}</p>
          {/if}
          <ProviderSignIn onError={onboarding.setAuthError} onConfigured={onboarding.markProviderConfigured} />
          <Button type="button" variant="link" size="sm" onclick={onboarding.next} class="h-auto justify-start p-0 type-meta text-[color:var(--color-fg-muted)] active:opacity-70">
            {onboarding.providerConfigured ? "continue" : "skip for now"}
          </Button>
        </OnboardingPanel>
      </CarouselItem>

      <!-- step 4 — done -->
      <CarouselItem class="min-h-0 overflow-y-auto pl-3">
        <OnboardingPanel eyebrow="done" title="you’re set">
          <div class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 text-center">
            <Check class="mx-auto mb-2 size-6 text-[color:var(--color-accent)]" />
            <p class="type-title font-medium">pico is connected to your host.</p>
            <p class="type-copy mt-1 text-[color:var(--color-fg-muted)]">provider sign-in is also in a session’s action menu.</p>
          </div>
          <Button type="button" class="w-full" onclick={() => navigateTo(routePaths.sessions, "replace")}>start your first session</Button>
        </OnboardingPanel>
      </CarouselItem>
    </CarouselContent>
  </Carousel>

  <div class="mt-4 flex items-center gap-2">
    <Button type="button" variant="outline" onclick={onboarding.back} disabled={onboarding.currentIndex === 0} class="flex-1">back</Button>
    {#if onboarding.currentIndex === 0}
      <Button type="button" onclick={onboarding.next} class="flex-1">get started <ArrowRight class="size-3.5" /></Button>
    {:else if onboarding.currentIndex < onboardingSteps.length - 1}
      <Button type="button" onclick={onboarding.next} disabled={onboarding.currentIndex >= onboarding.maxAllowedIndex} class="flex-1">next</Button>
    {:else}
      <div class="flex-1"></div>
    {/if}
  </div>

  <button type="button" class="type-meta mt-3 py-1 text-center text-[color:var(--color-fg-faint)] active:opacity-70" onclick={() => void skip()}>
    skip for now
  </button>
</main>
