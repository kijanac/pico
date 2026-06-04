<script lang="ts">
  import { onMount } from "svelte";
  import { Check, Copy, Loader2 } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { createOnboardingState, onboardingSteps } from "@/features/onboarding/onboarding.state.svelte";
  import SettingsField from "@/features/settings/components/SettingsField.svelte";
  import ProviderSignIn from "@/features/onboarding/components/ProviderSignIn.svelte";
  import OnboardingPanel from "@/features/onboarding/components/OnboardingPanel.svelte";
  import Checklist from "@/features/onboarding/components/Checklist.svelte";
  import ExternalLinkButton from "@/features/onboarding/components/ExternalLinkButton.svelte";
  import InfoRow from "@/features/onboarding/components/InfoRow.svelte";
  import { Button } from "@/shared/ui/button";
  import { Textarea } from "@/shared/ui/textarea";
  import { Carousel, CarouselContent, CarouselItem } from "@/shared/ui/carousel";
  import EdgeSwipeBack from "@/shared/components/EdgeSwipeBack.svelte";
  import HomePreview from "@/features/sessions/components/HomePreview.svelte";

  const onboarding = createOnboardingState();

  onMount(() => {
    void onboarding.load();
  });

  $effect(() => {
    void onboarding.persistDraft();
  });

  $effect(() => {
    onboarding.syncCarouselToIndex();
  });

  $effect(() => onboarding.bindCarouselSelection());
</script>

{#if !onboarding.loaded}
  <main class="type-copy flex flex-1 items-center justify-center p-4 text-[color:var(--color-fg-muted)]">
    loading onboarding…
  </main>
{:else}
  <EdgeSwipeBack href="/settings">
    {#snippet preview()}
      <HomePreview />
    {/snippet}

  <main class="flex min-h-0 flex-1 flex-col">
    <header class="flex items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-3 py-[calc(env(safe-area-inset-top)+12px)] pb-3">
      <Button type="button" variant="ghost" size="sm" onclick={() => navigateTo(routePaths.settings)}>back</Button>
      <h1 class="type-title font-medium">bridge onboarding</h1>
      <div class="w-12" aria-hidden="true"></div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col px-3 pt-4" style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem)">
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
          <CarouselItem class="min-h-0 overflow-y-auto pl-3">
            <OnboardingPanel eyebrow="step 1" title="before you start">
              <p class="type-copy text-[color:var(--color-fg-muted)]">
                pi-mobile will generate cloud-init for a fresh Linux box. The box will install pi-bridge, join your Tailscale tailnet, and expose HTTPS through Tailscale Serve.
              </p>
              <Checklist items={["Tailscale is installed and signed in on this phone", "You can create a VPS with cloud-init/user-data", "You can access Tailscale admin in a browser"]} />
              <ExternalLinkButton href="https://login.tailscale.com/admin/settings/keys">open Tailscale admin</ExternalLinkButton>
            </OnboardingPanel>
          </CarouselItem>

          <CarouselItem class="min-h-0 overflow-y-auto pl-3">
            <OnboardingPanel eyebrow="step 2" title="tailscale setup">
              <p class="type-copy text-[color:var(--color-fg-muted)]">
                Create a single-use, preauthorized auth key, then copy your tailnet DNS name from the DNS page. The bridge hostname is generated for you.
              </p>
              <div class="grid grid-cols-2 gap-2">
                <ExternalLinkButton href="https://login.tailscale.com/admin/settings/keys">keys</ExternalLinkButton>
                <ExternalLinkButton href="https://login.tailscale.com/admin/dns">dns</ExternalLinkButton>
              </div>
              <div class="space-y-3">
                <SettingsField id="ts_auth_key" label="tailscale auth key" value={onboarding.tsAuthKey} onValue={onboarding.setTsAuthKey} placeholder="tskey-auth-..." secret />
                <SettingsField id="tailnet" label="tailnet DNS name" value={onboarding.tailnet} onValue={onboarding.setTailnet} placeholder="tailabc123.ts.net" />
              </div>
              <Button type="button" variant="link" size="sm" onclick={() => onboarding.setShowAdvanced(!onboarding.showAdvanced)} class="h-auto justify-start p-0 type-meta text-[color:var(--color-accent)] active:opacity-70">
                {onboarding.showAdvanced ? "hide" : "show"} advanced hostname
              </Button>
              {#if onboarding.showAdvanced}
                <SettingsField id="bridge_hostname" label="bridge hostname" value={onboarding.bridgeHostname} onValue={onboarding.setBridgeHostname} placeholder="pi-bridge-ab12cd" />
              {/if}
              {#if onboarding.bridgeUrl}
                <InfoRow label="bridge URL will be" value={onboarding.bridgeUrl} />
              {/if}
            </OnboardingPanel>
          </CarouselItem>

          <CarouselItem class="min-h-0 overflow-y-auto pl-3">
            <OnboardingPanel eyebrow="step 3" title="copy cloud-init">
              <p class="type-copy text-[color:var(--color-fg-muted)]">
                Paste this into your cloud provider’s user-data/cloud-init field when creating the VPS. Use a fresh box.
              </p>
              <div>
                <label class="label mb-1.5 block" for="cloud_init">cloud-init</label>
                <Textarea id="cloud_init" readonly value={onboarding.cloudInit} rows={15} class="type-code min-h-0 resize-none bg-[color:var(--color-bg)] font-mono" />
              </div>
              <Button type="button" variant="outline" onclick={() => onboarding.copy(onboarding.cloudInit, "cloud-init")} class="w-full">
                <Copy class="size-3.5" /> {onboarding.copied === "cloud-init" ? "copied ✓" : "copy cloud-init"}
              </Button>
            </OnboardingPanel>
          </CarouselItem>

          <CarouselItem class="min-h-0 overflow-y-auto pl-3">
            <OnboardingPanel eyebrow="step 4" title="wait for bridge">
              <p class="type-copy text-[color:var(--color-fg-muted)]">
                After the VPS starts, pi-mobile will poll the Tailscale HTTPS URL. Keep the Tailscale app connected on this phone.
              </p>
              <InfoRow label="bridge url" value={onboarding.bridgeUrl} />
              <div class="type-copy rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-[color:var(--color-fg-muted)]">
                <div class="mb-1 flex items-center gap-2 text-[color:var(--color-fg)]">
                  {#if onboarding.connectState === "polling"}<Loader2 class="size-3.5 animate-spin" />{/if}
                  {#if onboarding.connectState === "claimed"}<Check class="size-3.5 text-[color:var(--color-accent)]" />{/if}
                  <span>{onboarding.connectState}</span>
                </div>
                {onboarding.connectMessage}
              </div>
              <Button type="button" disabled={!onboarding.bridgeUrl || onboarding.connectState === "polling"} onclick={onboarding.waitForBridge} class="w-full">
                {onboarding.connectState === "polling" ? "waiting…" : "wait for bridge"}
              </Button>
            </OnboardingPanel>
          </CarouselItem>

          <CarouselItem class="min-h-0 overflow-y-auto pl-3">
            <OnboardingPanel eyebrow="step 5" title="provider sign-in">
              <p class="type-copy text-[color:var(--color-fg-muted)]">
                Sign in to at least one provider so new sessions can use a model.
              </p>
              {#if onboarding.authError}
                <p class="type-meta rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[color:var(--color-danger)]">{onboarding.authError}</p>
              {/if}
              <ProviderSignIn onError={onboarding.setAuthError} onConfigured={onboarding.markProviderConfigured} />
            </OnboardingPanel>
          </CarouselItem>

          <CarouselItem class="min-h-0 overflow-y-auto pl-3">
            <OnboardingPanel eyebrow="done" title="bridge ready">
              <div class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 text-center">
                <Check class="mx-auto mb-2 size-6 text-[color:var(--color-accent)]" />
                <p class="type-title font-medium">pi-mobile is connected to your bridge.</p>
                <p class="type-copy mt-1 text-[color:var(--color-fg-muted)]">Provider sign-in is available from a session’s action menu when you’re ready.</p>
              </div>
              <Button type="button" class="w-full" onclick={() => navigateTo(routePaths.sessions)}>go to sessions</Button>
            </OnboardingPanel>
          </CarouselItem>
        </CarouselContent>
      </Carousel>

      <div class="mt-4 flex items-center gap-2">
        <Button type="button" variant="outline" onclick={onboarding.back} disabled={onboarding.currentIndex === 0} class="flex-1">back</Button>
        <Button type="button" onclick={onboarding.next} disabled={onboarding.currentIndex >= onboarding.maxAllowedIndex || onboarding.currentIndex === onboardingSteps.length - 1} class="flex-1">next</Button>
      </div>
    </div>
  </main>
  </EdgeSwipeBack>
{/if}
