<script lang="ts">
  import { onMount } from "svelte";
  import { Check, KeyRound, Loader2 } from "@lucide/svelte";
  import { authJobShouldPoll, createProviderAuthState } from "@/features/auth/provider-auth.state.svelte";
  import HostIssuePanel from "@/shared/components/HostIssuePanel.svelte";
  import { providerAuthMissingIssue } from "@/shared/lib/host-issues";
  import { Button } from "@/shared/ui/button";
  import { Textarea } from "@/shared/ui/textarea";
  import ActionRow from "@/shared/components/ActionRow.svelte";

  let {
    hostId,
    onError,
    onConfigured,
    class: className = "",
  }: {
    hostId?: string;
    onError: (message: string | null) => void;
    onConfigured?: () => void;
    class?: string;
  } = $props();

  // svelte-ignore state_referenced_locally
  const auth = createProviderAuthState({ hostId, onError, onConfigured });
  const missingProviderIssue = providerAuthMissingIssue();
  const configuredProviderCount = $derived(auth.providers.filter((provider) => provider.configured).length);

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
        <div class="type-copy text-[color:var(--color-fg-muted)]">loading providers…</div>
      {:else if auth.providers.length === 0}
        <HostIssuePanel issue={missingProviderIssue} />
      {:else if configuredProviderCount === 0}
        <HostIssuePanel issue={missingProviderIssue} compact />
      {/if}

      {#each auth.providers as provider (provider.id)}
        <ActionRow
          variant="card"
          onclick={() => auth.start(provider)}
          disabled={auth.startingProviderId !== null}
          class="hairline-b gap-3"
        >
          <span class="min-w-0 flex-1">
            <span class="block type-copy font-medium">{provider.name}</span>
            <span class="block type-meta text-[color:var(--color-fg-muted)]">
              {provider.configured ? `configured${provider.source ? ` via ${provider.source}` : ""}` : provider.authType === "oauth" ? "subscription sign-in" : provider.authType === "api_key" ? "API key" : "host setup required"}
            </span>
          </span>
          <span class="rounded-full border border-[color:var(--color-border)] px-2 py-0.5 type-label uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">
            {provider.authType === "oauth" ? "sign in" : provider.authType === "api_key" ? "key" : "setup"}
          </span>
          {#if provider.configured}
            <Check class="size-3.5 text-[color:var(--color-accent)]" />
          {/if}
          {#if auth.startingProviderId === provider.id}
            <Loader2 class="size-3.5 animate-spin" />
          {/if}
        </ActionRow>
      {/each}
    </div>
  {:else if auth.apiKeyProvider}
    <div class="space-y-3 type-copy">
      {@render InfoRow("provider", auth.apiKeyProvider.name)}
      <div>
        <label class="label mb-1.5 block" for="auth_api_key">API key</label>
        <Textarea
          id="auth_api_key"
          rows={3}
          value={auth.apiKeyInput}
          oninput={(event) => auth.setApiKeyInput(event.currentTarget.value)}
          placeholder="paste API key"
          class="min-h-0 type-copy"
        />
      </div>
      <Button type="button" class="w-full" disabled={!auth.apiKeyInput.trim() || auth.savingApiKey} onclick={() => auth.saveApiKey()}>
        {#if auth.savingApiKey}<Loader2 class="size-3.5 animate-spin" />{:else}<KeyRound class="size-3.5" />{/if}
        save API key
      </Button>
      <Button type="button" variant="outline" class="w-full text-[color:var(--color-fg-muted)]" onclick={() => auth.selectApiKeyProvider(null)}>cancel</Button>
    </div>
  {:else if auth.job}
    <div class="space-y-3 type-copy">
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
        <p class="type-copy text-[color:var(--color-fg-muted)]">{auth.job.instructions}</p>
      {/if}
      {#if auth.job.progress}
        <p class="type-meta text-[color:var(--color-fg-muted)]">{auth.job.progress}</p>
      {/if}
      {#if auth.job.error}
        <p class="type-meta text-[color:var(--color-danger)]">{auth.job.error}</p>
      {/if}

      {#if auth.job.status === "select" && auth.job.selectOptions}
        <div class="space-y-2">
          <p class="type-copy text-[color:var(--color-fg-muted)]">{auth.job.selectMessage ?? "choose an option"}</p>
          {#each auth.job.selectOptions as option (option.id)}
            <ActionRow variant="card" class="hairline-b" onclick={() => auth.submit(option.id)}>
              <span class="type-copy font-medium text-[color:var(--color-fg)]">{option.label}</span>
            </ActionRow>
          {/each}
        </div>
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
            class="min-h-0 type-copy"
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
    <div class="mt-1 break-words type-copy text-[color:var(--color-fg)]">{value}</div>
  </div>
{/snippet}
