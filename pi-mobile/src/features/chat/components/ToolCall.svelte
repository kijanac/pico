<script lang="ts">
  import { Check, FileText, Loader2, Pencil, PlusSquare, Terminal, X } from "@lucide/svelte";
  import type { ToolCallMessage } from "@pico/protocol";
  import { shortPath } from "@/shared/lib/format";
  import EditDiff from "@/features/chat/components/EditDiff.svelte";
  import ToolResult from "@/features/chat/components/ToolResult.svelte";

  let { msg }: { msg: ToolCallMessage } = $props();
  // svelte-ignore state_referenced_locally
  let open = $state(msg.toolKind === "builtin" && msg.tool === "edit");

  const label = $derived(msg.toolKind === "builtin" ? msg.tool : msg.tool);
  const summary = $derived.by(() => {
    if (msg.toolKind === "custom") return JSON.stringify(msg.args);
    switch (msg.tool) {
      case "read":
      case "write":
      case "edit":
        return shortPath(msg.args.path, 2);
      case "bash":
        return msg.args.command;
    }
  });
</script>

<div class="px-3 py-1">
  <button
    type="button"
    onclick={() => (open = !open)}
    class="group flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 py-1.5 text-left active:bg-[color:var(--color-surface-2)]"
  >
    <span class="flex h-4 w-4 items-center justify-center text-[color:var(--color-fg-muted)]">
      {#if msg.toolKind === "builtin" && msg.tool === "read"}
        <FileText class="size-3" />
      {:else if msg.toolKind === "builtin" && msg.tool === "write"}
        <PlusSquare class="size-3" />
      {:else if msg.toolKind === "builtin" && msg.tool === "edit"}
        <Pencil class="size-3" />
      {:else}
        <Terminal class="size-3" />
      {/if}
    </span>

    <span class="type-label uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">{label}</span>
    <span class="type-meta min-w-0 flex-1 truncate text-[color:var(--color-fg)]">{summary}</span>

    {#if msg.status === "running"}
      <Loader2 class="size-3 animate-spin text-[color:var(--color-accent)]" />
    {:else if msg.status === "ok"}
      <Check class="size-3 text-[color:var(--color-fg-faint)]" />
      {#if msg.durationMs !== undefined}
        <span class="type-label uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)] tabular-nums">{msg.durationMs}ms</span>
      {/if}
    {:else if msg.status === "error"}
      <X class="size-3 text-[color:var(--color-danger)]" />
    {/if}
  </button>

  {#if open}
    {#if msg.toolKind === "builtin" && msg.tool === "edit"}
      <div class="mt-1">
        <EditDiff args={msg.args} />
      </div>
    {:else if msg.result || (msg.toolKind === "builtin" && msg.tool === "write" && msg.args.content.length > 0)}
      <ToolResult {msg} />
    {/if}
  {/if}
</div>
