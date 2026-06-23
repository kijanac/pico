<script lang="ts">
  import { Check, ChevronLeft, ChevronRight, Folder, Home } from "@lucide/svelte";
  import { Effect } from "effect";
  import type { FsListing } from "@pico/protocol/rpc";
  import { settingsState } from "@/features/settings/settings.state.svelte";
  import { listDirectories } from "@/features/sessions/api";
  import ActionRow from "@/shared/components/ActionRow.svelte";
  import { classifyHostFailure } from "@/shared/lib/host-issues";
  import { runHost } from "@/shared/lib/rpc-client";
  import { Button } from "@/shared/ui/button";

  let { initial, onSelect }: { initial?: string; onSelect: (path: string) => void } = $props();

  // svelte-ignore state_referenced_locally
  let path = $state<string | undefined>(initial);
  let listing = $state<FsListing | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let listingRequestId = 0;

  $effect(() => {
    void load(path);
  });

  async function load(nextPath?: string): Promise<void> {
    const requestId = ++listingRequestId;
    loading = true;
    error = null;
    if (!settingsState.loaded) await settingsState.load();
    await runHost(
      listDirectories(nextPath).pipe(
        Effect.tap((nextListing) =>
          Effect.sync(() => {
            if (requestId !== listingRequestId || nextPath !== path) return;
            listing = nextListing;
          }),
        ),
        Effect.catchAll((caught) =>
          classifyHostFailure(caught, { url: settingsState.hostUrl }).pipe(
            Effect.andThen((issue) =>
              Effect.sync(() => {
                if (requestId !== listingRequestId || nextPath !== path) return;
                error = `${issue.title}: ${issue.message}`;
              }),
            ),
          ),
        ),
      ),
    );
    if (requestId === listingRequestId) loading = false;
  }

  function drill(name: string): void {
    if (!listing) return;
    path = `${listing.path.replace(/\/$/, "")}/${name}`;
  }

  function goUp(): void {
    if (listing?.parent) path = listing.parent;
  }

  function goHome(): void {
    if (listing) path = listing.home;
  }

  const segments = $derived.by(() => {
    if (!listing?.path) return [];
    let display = listing.path;
    let basePath = "/";
    if (listing.home && (listing.path === listing.home || listing.path.startsWith(`${listing.home}/`))) {
      display = listing.path === listing.home ? "~" : `~${listing.path.slice(listing.home.length)}`;
      basePath = listing.home;
    }
    const parts = display.split("/").filter(Boolean);
    if (display.startsWith("~")) {
      return parts.map((name, index) => ({
        name,
        path: index === 0 ? basePath : `${basePath}/${parts.slice(1, index + 1).join("/")}`,
      }));
    }
    return parts.map((name, index) => ({
      name,
      path: `/${parts.slice(0, index + 1).join("/")}`,
    }));
  });
</script>

<div class="flex min-h-0 flex-1 flex-col bg-[color:var(--color-bg)]">
  <div class="hairline-b flex items-center gap-2 px-2 py-1.5">
    <div class="min-w-0 flex-1 overflow-x-auto">
      <div class="flex items-center gap-0.5 whitespace-nowrap">
        {#each segments as segment, index}
          {#if index > 0}
            <ChevronRight class="size-2.5 shrink-0 text-[color:var(--color-fg-faint)]" />
          {/if}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onclick={() => (path = segment.path)}
            class="h-auto rounded-[var(--radius-sm)] px-1.5 py-0.5 type-meta text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
          >
            {segment.name}
          </Button>
        {/each}
      </div>
    </div>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onclick={goHome}
      class="shrink-0 rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
      aria-label="Home"
      title="Go to home directory"
    >
      <Home class="size-3.5" />
    </Button>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <div class="type-copy px-3 py-3 text-[color:var(--color-fg-muted)]">loading…</div>
    {/if}
    {#if error}
      <div class="type-copy px-3 py-3 text-[color:var(--color-danger)]">{error}</div>
    {/if}
    {#if listing}
      {#if listing.parent !== null}
        <ActionRow onclick={goUp}>
          <ChevronLeft class="size-3.5 text-[color:var(--color-fg-muted)]" />
          <span class="type-copy text-[color:var(--color-fg-muted)]">..</span>
        </ActionRow>
      {/if}
      {#each listing.entries as entry (entry.name)}
        <ActionRow onclick={() => drill(entry.name)}>
          <Folder class="size-3.5 shrink-0 text-[color:var(--color-fg-muted)]" />
          <span class="type-copy min-w-0 flex-1 truncate">{entry.name}</span>
          <ChevronRight class="size-3 shrink-0 text-[color:var(--color-fg-faint)]" />
        </ActionRow>
      {:else}
        <div class="type-copy px-3 py-3 text-[color:var(--color-fg-muted)]">(no subdirectories)</div>
      {/each}
    {/if}
  </div>

  <div class="hairline-t bg-[color:var(--color-bg)]/95 p-2 backdrop-blur-md">
    <Button type="button" disabled={!listing} class="h-10 w-full" onclick={() => listing && onSelect(listing.path)}>
      <Check class="size-3.5" />
      use this directory
    </Button>
  </div>
</div>
