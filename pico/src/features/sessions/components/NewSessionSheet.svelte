<script lang="ts">
  import { ChevronLeft, Folder, Plus } from "@lucide/svelte";
  import CwdPicker from "@/features/sessions/components/CwdPicker.svelte";
  import type { HostProfile } from "@/features/hosts/host-registry.state.svelte";
  import { Button } from "@/shared/ui/button";
  import { Input } from "@/shared/ui/input";
  import * as Sheet from "@/shared/ui/sheet";

  let {
    open = $bindable(false),
    hosts,
    defaultHostId,
    creating = false,
    onCreate,
  }: {
    open: boolean;
    hosts: readonly HostProfile[];
    defaultHostId: string | null;
    creating?: boolean;
    onCreate: (opts: { hostId: string; cwd: string; title: string }) => void;
  } = $props();

  let hostId = $state<string | null>(null);
  let cwd = $state<string | undefined>();
  let title = $state("");
  let pickerOpen = $state(false);

  const effectiveTitle = $derived.by(() => {
    const trimmed = title.trim();
    if (trimmed.length > 0) return trimmed;
    return cwd ? basename(cwd) : "";
  });

  const canCreate = $derived(!!hostId && !!cwd && !creating);

  $effect(() => {
    if (!hostId || !hosts.some((host) => host.id === hostId)) hostId = defaultHostId ?? hosts[0]?.id ?? null;
  });

  function handleCreate(): void {
    if (!hostId || !cwd || !canCreate) return;
    onCreate({ hostId, cwd, title: effectiveTitle });
  }

  function basename(path: string): string {
    const trimmed = path.replace(/\/+$/, "");
    const index = trimmed.lastIndexOf("/");
    return index >= 0 ? trimmed.slice(index + 1) : trimmed;
  }
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent class="max-h-[92dvh]">
    <Sheet.Header class="hairline-b flex-row items-center gap-1 space-y-0 px-2 py-2 pr-12 text-left">
      {#if pickerOpen}
        <Button type="button" variant="ghost" size="icon" onclick={() => (pickerOpen = false)} aria-label="Back">
          <ChevronLeft class="size-4" />
        </Button>
      {:else}
        <div class="h-9 w-9"></div>
      {/if}
      <Sheet.Title class="type-title min-w-0 flex-1 px-1 font-medium">
        {pickerOpen ? "choose directory" : "new session"}
      </Sheet.Title>
    </Sheet.Header>

    {#if pickerOpen}
      {#if hostId}
        <CwdPicker
        {hostId}
        initial={cwd}
        onSelect={(path) => {
          cwd = path;
          pickerOpen = false;
        }}
        />
      {/if}
    {:else}
      <div class="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        <label class="block">
          <div class="label mb-1.5">host</div>
          <select
            value={hostId ?? ""}
            onchange={(event) => {
              hostId = event.currentTarget.value || null;
              cwd = undefined;
            }}
            class="type-copy h-10 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[color:var(--color-fg)]"
          >
            {#each hosts as host (host.id)}
              <option value={host.id}>{host.name}</option>
            {/each}
          </select>
        </label>

        <label class="block">
          <div class="label mb-1.5">cwd</div>
          <Button
            type="button"
            variant="outline"
            disabled={!hostId}
            onclick={() => (pickerOpen = true)}
            class="h-auto w-full justify-start gap-2 rounded-[var(--radius-md)] border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2.5 text-left active:bg-[color:var(--color-surface-2)]"
          >
            <Folder class="size-3.5 shrink-0 text-[color:var(--color-fg-muted)]" />
            {#if cwd}
              <span class="type-copy min-w-0 flex-1 truncate">{cwd}</span>
            {:else}
              <span class="type-copy text-[color:var(--color-fg-muted)]">choose a directory…</span>
            {/if}
          </Button>
        </label>

        <div>
          <label class="label mb-1.5 block" for="session_title">title</label>
          <Input id="session_title" type="text" bind:value={title} placeholder={cwd ? basename(cwd) : "session title"} class="h-10" />
        </div>

      </div>

      <div class="px-3 pt-2">
        <Button type="button" disabled={!canCreate} class="h-10 w-full" onclick={handleCreate}>
          <Plus class="size-3.5" />
          {creating ? "creating…" : "create session"}
        </Button>
      </div>
    {/if}
  </Sheet.BottomContent>
</Sheet.Root>
