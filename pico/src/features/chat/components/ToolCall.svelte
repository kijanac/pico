<script lang="ts">
  import { tick } from "svelte";
  import { Check, FileText, Loader2, Pencil, PlusSquare, Terminal, X } from "@lucide/svelte";
  import { hasToolDetails, type ToolCallMessage } from "@pico/protocol";
  import { shortPath } from "@/shared/lib/format";
  import EditDiff from "@/features/chat/components/EditDiff.svelte";
  import ToolResult from "@/features/chat/components/ToolResult.svelte";

  let { msg }: { msg: ToolCallMessage } = $props();

  let open = $state(false);
  let detailScroller: HTMLDivElement | null = $state(null);
  // Live output follows its end until the reader scrolls up in the pane.
  let following = true;

  const isEdit = $derived(msg.toolKind === "builtin" && msg.tool === "edit");
  const isCustom = $derived(msg.toolKind === "custom");
  const hasResultPane = $derived(
    Boolean(msg.result || msg.resultContent || hasToolDetails(msg.details) || (msg.toolKind === "builtin" && msg.tool === "write" && msg.args.content.length > 0)),
  );
  // Being written by the model, or running.
  const live = $derived(msg.status === "running" || msg.status === "pending");
  const detailScrollVersion = $derived.by(() => {
    const contentLength = msg.resultContent?.reduce((total, part) => total + (part.type === "text" ? part.text.length : part.data.length), 0) ?? 0;
    const written = msg.toolKind === "builtin" && msg.tool === "write" ? msg.args.content.length : 0;
    return `${msg.status}:${msg.result?.length ?? 0}:${msg.resultContent?.length ?? 0}:${contentLength}:${written}:${hasToolDetails(msg.details)}`;
  });

  $effect(() => {
    if (live && hasResultPane) open = true;
  });

  // An edit opens on its diff once its arguments are complete, as pi's TUI computes it then.
  let editOpened = false;
  $effect(() => {
    if (editOpened || !isEdit || msg.status === "pending") return;
    editOpened = true;
    open = true;
  });

  $effect(() => {
    detailScrollVersion;
    if (!live) return;
    void tick().then(() => {
      if (detailScroller && following) detailScroller.scrollTop = detailScroller.scrollHeight;
    });
  });

  function onDetailScroll(): void {
    if (detailScroller) following = detailScroller.scrollHeight - detailScroller.scrollTop - detailScroller.clientHeight < 24;
  }

  const label = $derived(msg.toolKind === "builtin" ? msg.tool : msg.tool);
  const summary = $derived.by(() => {
    // No arguments yet (still being written) or none at all: nothing to summarize.
    if (msg.toolKind === "custom") return Object.keys(msg.args).length > 0 ? JSON.stringify(msg.args) : "";
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

<div class="px-3">
  <button
    type="button"
    onclick={() => (open = !open)}
    class="group flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 py-1.5 text-left active:bg-[color:var(--color-surface-2)]"
  >
    <span class="flex h-4 w-4 shrink-0 items-center justify-center text-[color:var(--color-fg-muted)]">
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

    <span class="type-label shrink-0 uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)]">{label}</span>
    <span class="type-meta min-w-0 flex-1 overflow-hidden pr-1 text-[color:var(--color-fg)]">
      <span class="block truncate">{summary}</span>
    </span>

    <span class="ml-auto flex shrink-0 items-center gap-1">
      {#if live}
        <Loader2 class="size-3 animate-spin text-[color:var(--color-accent)]" />
      {:else if msg.status === "ok"}
        <Check class="size-3 text-[color:var(--color-fg-faint)]" />
        {#if msg.durationMs !== undefined}
          <span class="type-label uppercase tracking-[0.08em] text-[color:var(--color-fg-faint)] tabular-nums">{msg.durationMs}ms</span>
        {/if}
      {:else if msg.status === "error"}
        <X class="size-3 text-[color:var(--color-danger)]" />
      {/if}
    </span>
  </button>

  {#if open && (isEdit || isCustom || hasResultPane)}
    <div
      bind:this={detailScroller}
      onscroll={onDetailScroll}
      class="scroll-momentum mt-1 max-h-[min(22rem,48vh)] overflow-y-auto overscroll-contain rounded-[var(--radius-sm)]"
      aria-label={`${label} details`}
    >
      {#if isEdit && msg.toolKind === "builtin" && msg.tool === "edit"}
        {#if msg.status !== "pending"}<EditDiff args={msg.args} />{/if}
      {:else}
        {#if isCustom && msg.toolKind === "custom"}
          <pre
            class="whitespace-pre-wrap break-words rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-code-bg)] px-3 py-2 type-code text-[color:var(--color-code-fg)]">{JSON.stringify(
              msg.args,
              null,
              2,
            )}</pre>
        {/if}
        {#if hasResultPane}
          <ToolResult {msg} />
        {/if}
      {/if}
    </div>
  {/if}
</div>
