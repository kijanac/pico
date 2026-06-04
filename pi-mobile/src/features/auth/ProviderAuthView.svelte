<script lang="ts">
  import { onMount } from "svelte";
  import { Check, KeyRound, Loader2 } from "@lucide/svelte";
  import { authJobShouldPoll, createProviderAuthState } from "@/features/auth/provider-auth.state.svelte";
  import { Button } from "@/shared/ui/button";
  import { Textarea } from "@/shared/ui/textarea";

  let {
    onError,
    onConfigured,
    class: className = "",
  }: {
    onError: (message: string | null) => void;
    onConfigured?: () => void;
    class?: string;
  } = $props();

  // svelte-ignore state_referenced_locally
  const auth = createProviderAuthState({ onError, onConfigured });

  onMount(() => {
    void auth.loadProviders();
  });

  $effect(() => {
    if (!authJobShouldPoll(auth.job)) return;
    const interval = window.setInterval(() => {
      void auth.refreshJob();
    }, 1200);
    return () => window.clearInterval(interval);
  });
</script>

<div class={`flex-1 overflow-y-auto ${className}`}>
  {#if !auth.job && !auth.apiKeyProvider}
    <div class="space-y-2">
      {#if auth.loading}
        <div class="text-copy text-[color:var(--color-fg-muted)]">loading providers…</div>
      {/if}

      {#each auth.providers as provider (provider.id)}
        <button
          type="button"
          onclick={() => auth.start(provider)}
          disabled={auth.startingProviderId !== null}
          class="hairline-b flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)] disabled:opacity-70"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-copy font-medium">{provider.name}</span>
            <span class="block text-meta text-[color:var(--color-fg-muted)]">
              {provider.configured ? `configured${provider.source ? ` via ${provider.source}` : ""}` : provider.authType === "oauth" ? "subscription sign-in" : provider.authType === "api_key" ? "API key" : "bridge setup required"}
            </span>
          </span>
          <span class="rounded-full border border-[color:var(--color-border)] px-2 py-0.5 text-label uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">
            {provider.authType === "oauth" ? "sign in" : provider.authType === "api_key" ? "key" : "setup"}
          </span>
          {#if provider.configured}
            <Check class="size-3.5 text-[color:var(--color-accent)]" />
          {/if}
          {#if auth.startingProviderId === provider.id}
            <Loader2 class="size-3.5 animate-spin" />
          {/if}
        </button>
      {/each}
    </div>
  {:else if auth.apiKeyProvider}
    <div class="space-y-3 text-copy">
      {@render InfoRow("provider", auth.apiKeyProvider.name)}
      <div>
        <label class="label mb-1.5 block" for="auth_api_key">API key</label>
        <Textarea
          id="auth_api_key"
          rows={3}
          value={auth.apiKeyInput}
          oninput={(event) => auth.setApiKeyInput(event.currentTarget.value)}
          placeholder="paste API key"
          class="min-h-0 text-copy"
        />
      </div>
      <Button type="button" class="w-full" disabled={!auth.apiKeyInput.trim() || auth.savingApiKey} onclick={() => auth.saveApiKey()}>
        {#if auth.savingApiKey}<Loader2 class="size-3.5 animate-spin" />{:else}<KeyRound class="size-3.5" />{/if}
        save API key
      </Button>
      <Button type="button" variant="outline" class="w-full text-[color:var(--color-fg-muted)]" onclick={() => auth.selectApiKeyProvider(null)}>cancel</Button>
    </div>
  {:else if auth.job}
    <div class="space-y-3 text-copy">
      {@render InfoRow("provider", auth.job.providerName ?? auth.job.providerId)}
      {@render InfoRow("status", auth.job.status)}

      {#if auth.job.authUrl}
        <a class="block rounded-[var(--radius-md)] bg-[color:var(--color-accent)] px-3 py-3 text-center font-medium text-[color:var(--color-bg)]" href={auth.job.authUrl} target="_blank" rel="noreferrer">open sign-in page</a>
      {/if}
      {#if auth.job.verificationUri}
        <a class="block rounded-[var(--radius-md)] bg-[color:var(--color-accent)] px-3 py-3 text-center font-medium text-[color:var(--color-bg)]" href={auth.job.verificationUri} target="_blank" rel="noreferrer">open verification page</a>
      {/if}
      {#if auth.job.userCode}
        {@render InfoRow("device code", auth.job.userCode)}
      {/if}
      {#if auth.job.instructions}
        <p class="text-copy text-[color:var(--color-fg-muted)]">{auth.job.instructions}</p>
      {/if}
      {#if auth.job.progress}
        <p class="text-meta text-[color:var(--color-fg-muted)]">{auth.job.progress}</p>
      {/if}
      {#if auth.job.error}
        <p class="text-meta text-[color:var(--color-danger)]">{auth.job.error}</p>
      {/if}

      {#if auth.job.status === "prompt" || auth.job.status === "manual"}
        <div>
          <label class="label mb-1.5 block" for="auth_input">{auth.job.promptMessage ?? "input"}</label>
          <Textarea
            id="auth_input"
            rows={3}
            value={auth.input}
            oninput={(event) => auth.setInput(event.currentTarget.value)}
            placeholder={auth.job.promptPlaceholder ?? "paste code or redirect URL"}
            class="min-h-0 text-copy"
          />
        </div>
        <Button type="button" class="w-full" onclick={() => auth.submit()}>submit</Button>
      {/if}

      <Button type="button" variant="outline" class="w-full" onclick={() => auth.refreshJob()}>refresh</Button>
      <Button type="button" variant="outline" class="w-full text-[color:var(--color-fg-muted)]" onclick={() => auth.cancel()}>cancel</Button>
    </div>
  {/if}
</div>

{#snippet InfoRow(label: string, value: string)}
  <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2">
    <div class="label">{label}</div>
    <div class="mt-1 break-words text-copy text-[color:var(--color-fg)]">{value}</div>
  </div>
{/snippet}
