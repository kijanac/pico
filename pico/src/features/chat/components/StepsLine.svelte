<script lang="ts">
  import { ChevronRight } from "@lucide/svelte";
  import type { StepsSummary } from "@/features/chat/model/steps";
  import { formatDuration } from "@/shared/lib/format";

  let { summary, inProgress, durationMs, open, onToggle }: { summary: StepsSummary; inProgress: boolean; durationMs?: number; open: boolean; onToggle: () => void } = $props();

  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const parts = $derived(
    [
      { text: `${count(summary.steps, "step")}${inProgress ? " so far" : ""}` },
      summary.filesChanged > 0 && { text: `${count(summary.filesChanged, "file")} changed` },
      summary.commandsRun > 0 && { text: count(summary.commandsRun, "command") },
      summary.failed > 0 && { text: `${summary.failed} failed`, failed: true },
      durationMs !== undefined && { text: formatDuration(durationMs) },
    ].filter((part) => part !== false),
  );
</script>

<div class="px-3">
  <button
    type="button"
    aria-expanded={open}
    aria-label={parts.map((part) => part.text).join(", ")}
    onclick={onToggle}
    class="type-meta flex w-full items-start gap-1.5 py-1 text-left text-[color:var(--color-fg-muted)] pointer-coarse:py-2.5 active:opacity-70"
  >
    <ChevronRight class={["mt-[0.2em] size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90"]} />
    <span class="dot-separated flex min-w-0 flex-wrap gap-x-1.5 tabular-nums">
      {#each parts as part (part.text)}
        <span class={["failed" in part && "text-[color:var(--color-danger)]"]}>{part.text}</span>
      {/each}
    </span>
  </button>
</div>

<style>
  .dot-separated > span {
    white-space: nowrap;
  }

  .dot-separated > span:not(:last-child)::after {
    content: "·";
    margin-left: 0.375rem;
    color: var(--color-fg-muted);
  }
</style>
