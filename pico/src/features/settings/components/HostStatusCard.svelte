<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Copy, MoreHorizontal, Pencil, RefreshCw, Star, Trash2 } from "@lucide/svelte";
  import { Effect } from "effect";
  import type { HostProfile } from "@/features/hosts/host-registry.state.svelte";
  import { hostRegistryState } from "@/features/hosts/host-registry.state.svelte";
  import { healthcheckHost } from "@/features/settings/api";
  import ActionRow from "@/shared/components/ActionRow.svelte";
  import HostIssuePanel from "@/shared/components/HostIssuePanel.svelte";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import { reachabilityIssue, type HostIssue } from "@/shared/lib/host-issues";
  import { copyText } from "@/shared/mobile/clipboard";
  import { haptics } from "@/shared/mobile/haptics";
  import { Button } from "@/shared/ui/button";
  import { Input } from "@/shared/ui/input";
  import * as Sheet from "@/shared/ui/sheet";

  type HostStatus = "idle" | "checking" | "online" | "offline";
  type DotTone = "muted" | "accent" | "warn" | "danger";

  const statusLabels: Record<HostStatus, string> = {
    idle: "not checked",
    checking: "checking",
    online: "online",
    offline: "offline",
  };

  let { host }: { host: HostProfile } = $props();

  let status = $state<HostStatus>("idle");
  let issue = $state<HostIssue | null>(null);
  let copiedUrl = $state(false);
  let menuOpen = $state(false);
  let renameOpen = $state(false);
  let renameDraft = $state("");
  let renameSaving = $state(false);
  let renameError = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  const isDefault = $derived(hostRegistryState.defaultHostId === host.id);
  const canRemove = $derived(hostRegistryState.hosts.length > 1);
  const statusLabel = $derived(statusLabels[status]);
  const statusDotTone = $derived<DotTone>(status === "online" || status === "checking" ? "accent" : status === "offline" ? "danger" : "muted");
  const statusDotActive = $derived(status === "checking");
  const canSaveRename = $derived(renameDraft.trim().length > 0 && renameDraft.trim() !== host.name && !renameSaving);

  onMount(() => {
    void refresh();
  });

  onDestroy(() => {
    if (copiedTimer !== null) clearTimeout(copiedTimer);
  });

  async function refresh(): Promise<void> {
    status = "checking";
    issue = null;
    const reachability = await Effect.runPromise(healthcheckHost(host.url));
    status = reachability === "healthy" ? "online" : "offline";
    issue = reachability === "healthy" ? null : reachabilityIssue(reachability, { url: host.url });
  }

  async function copyUrl(): Promise<void> {
    try {
      await copyText(host.url);
      copiedUrl = true;
      haptics.success();
      if (copiedTimer !== null) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copiedUrl = false;
        copiedTimer = null;
      }, 1500);
    } catch {
      haptics.warning();
    }
  }

  function openRename(): void {
    renameDraft = host.name;
    renameError = null;
    menuOpen = false;
    renameOpen = true;
  }

  async function saveRename(): Promise<void> {
    if (!canSaveRename) return;
    renameSaving = true;
    renameError = null;
    try {
      await hostRegistryState.renameHost(host.id, renameDraft);
      haptics.success();
      renameOpen = false;
    } catch (error) {
      renameError = error instanceof Error ? error.message : String(error);
      haptics.warning();
    } finally {
      renameSaving = false;
    }
  }

  async function removeHost(): Promise<void> {
    if (!canRemove) return;
    menuOpen = false;
    await hostRegistryState.removeHost(host.id);
    haptics.heavy();
  }
</script>

<section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <div class="flex items-start gap-2">
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="type-title min-w-0 truncate font-medium text-[color:var(--color-fg)]">{host.name}</h2>
      </div>
      <button type="button" class="mt-1 flex max-w-full min-w-0 items-center gap-2 text-left" title="Copy host URL" aria-label={`Copy host URL: ${host.url}`} onclick={() => void copyUrl()}>
        <span class="type-copy min-w-0 truncate text-[color:var(--color-fg-muted)]">{host.url}</span>
        {#if copiedUrl}
          <span class="type-label shrink-0 uppercase tracking-[0.08em] text-[color:var(--color-accent)]">copied</span>
        {/if}
      </button>
      <div class="type-label mt-2 flex items-center gap-1.5 uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]" aria-live="polite">
        <StatusDot tone={statusDotTone} active={statusDotActive} label={statusLabel} size={6} />
        <span>{statusLabel}</span>
        <span aria-hidden="true">·</span>
        <Button type="button" variant="ghost" size="icon-xs" disabled={status === "checking"} onclick={() => void refresh()} class="-my-1 size-6 text-[color:var(--color-fg-muted)]" aria-label="Refresh host status" title="Refresh status">
          <RefreshCw class={status === "checking" ? "size-3 animate-spin" : "size-3"} />
        </Button>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class={isDefault ? "text-[color:var(--color-accent)]" : "text-[color:var(--color-fg-muted)]"}
        onclick={() => {
          if (!isDefault) void hostRegistryState.setDefaultHost(host.id);
        }}
        aria-label={isDefault ? "Default host" : "Make default host"}
        aria-pressed={isDefault}
        title={isDefault ? "Default host" : "Make default"}
      >
        <Star class="size-3.5" fill={isDefault ? "currentColor" : "none"} />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" class="text-[color:var(--color-fg-muted)]" onclick={() => (menuOpen = true)} aria-label="Host actions" title="Host actions">
        <MoreHorizontal class="size-3.5" />
      </Button>
    </div>
  </div>

  {#if status === "offline" && issue}
    <HostIssuePanel issue={issue} compact class="mt-3" />
  {/if}
</section>

<Sheet.Root bind:open={menuOpen}>
  <Sheet.BottomContent>
    <SheetHeader title={host.name} description={host.url} />
    <div class="py-2">
      <ActionRow onclick={openRename}>
        <Pencil class="size-3.5 text-[color:var(--color-fg-muted)]" />
        <span class="type-copy font-medium">rename host</span>
      </ActionRow>
      <ActionRow onclick={() => {
        menuOpen = false;
        void copyUrl();
      }}>
        <Copy class="size-3.5 text-[color:var(--color-fg-muted)]" />
        <span class="type-copy font-medium">copy URL</span>
      </ActionRow>
      <ActionRow disabled={!canRemove} onclick={() => void removeHost()}>
        <Trash2 class="size-3.5 text-[color:var(--color-danger)]" />
        <span class="type-copy font-medium text-[color:var(--color-danger)]">remove host</span>
      </ActionRow>
    </div>
  </Sheet.BottomContent>
</Sheet.Root>

<Sheet.Root bind:open={renameOpen}>
  <Sheet.BottomContent>
    <SheetHeader title="rename host" description={host.url} />
    <form class="space-y-4 px-3 py-3" onsubmit={(event) => {
      event.preventDefault();
      void saveRename();
    }}>
      <Input bind:value={renameDraft} type="text" class="h-10" aria-label="Host name" />
      {#if renameError}
        <div class="type-meta text-[color:var(--color-danger)]">{renameError}</div>
      {/if}
      <div class="flex gap-2">
        <Button type="button" variant="outline" class="h-10 flex-1" onclick={() => (renameOpen = false)} disabled={renameSaving}>cancel</Button>
        <Button type="submit" class="h-10 flex-1" disabled={!canSaveRename}>{renameSaving ? "saving…" : "save"}</Button>
      </div>
    </form>
  </Sheet.BottomContent>
</Sheet.Root>
