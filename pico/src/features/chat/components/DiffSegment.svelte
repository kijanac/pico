<script lang="ts">
  import { diffRuns, runLineNumbers, type DiffRun } from "./diff-runs";
  import { Effect, Fiber } from "effect";
  import { highlightLines, inferLangFromPath } from "@/shared/lib/highlighter";

  let { oldText, newText, path, full = false }: { oldText: string; newText: string; path: string; full?: boolean } = $props();

  type LineKind = "add" | "remove" | "context";

  interface DiffLine {
    kind: LineKind;
    oldLine: number | null;
    newLine: number | null;
    text: string;
  }

  interface CollapsedSegment {
    kind: "hunk" | "skip";
    lines?: DiffLine[];
    skipped?: number;
  }

  const CONTEXT_LINES = 3;

  const runs = $derived(diffRuns(oldText, newText));
  const lines = $derived(full ? [] : toDiffLines(runs));
  const segments = $derived(collapseContext(lines));
  const lastLine = $derived(runs.reduce((last, run) => Math.max(last, (run.newLine ?? run.oldLine ?? 1) + run.count - 1), 1));
  const gutterWidth = $derived(`${Math.max(3, String(lastLine).length)}ch`);

  let highlighted = $state<{ old: string[]; neu: string[] } | null>(null);
  const lang = $derived(inferLangFromPath(path));

  $effect(() => {
    const oldCode = oldText;
    const newCode = newText;
    const currentLang = lang;
    highlighted = null;
    if (!currentLang) return;

    const task = Effect.runFork(Effect.all([
      Effect.tryPromise({ try: (signal) => highlightLines(oldCode, currentLang, signal), catch: () => null }),
      Effect.tryPromise({ try: (signal) => highlightLines(newCode, currentLang, signal), catch: () => null }),
    ], { concurrency: 2 }).pipe(
      Effect.tap(([old, neu]) => Effect.sync(() => { if (old && neu) highlighted = { old, neu }; })),
      Effect.catchAll(() => Effect.void),
    ));
    return () => { Effect.runFork(Fiber.interrupt(task)); };
  });

  function toDiffLines(changes: DiffRun[]): DiffLine[] {
    return changes.flatMap((run) => {
      const text = run.text.split("\n");
      if (text.at(-1) === "") text.pop();
      return text.map((line, index) => ({
        kind: run.kind,
        oldLine: run.oldLine === null ? null : run.oldLine + index,
        newLine: run.newLine === null ? null : run.newLine + index,
        text: line,
      }));
    });
  }

  function highlightedRun(run: DiffRun): string | null {
    if (!highlighted) return null;
    const start = (run.newLine ?? run.oldLine ?? 1) - 1;
    const source = run.kind === "remove" ? highlighted.old : highlighted.neu;
    return source.slice(start, start + run.count).join("\n");
  }

  function collapseContext(diff: DiffLine[]): CollapsedSegment[] {
    const changedIndexes: number[] = [];
    for (let index = 0; index < diff.length; index += 1) {
      if (diff[index]?.kind !== "context") changedIndexes.push(index);
    }
    if (changedIndexes.length === 0) return [{ kind: "hunk", lines: diff }];

    const ranges: Array<[number, number]> = changedIndexes.map((index) => [
      Math.max(0, index - CONTEXT_LINES),
      Math.min(diff.length - 1, index + CONTEXT_LINES),
    ]);
    const merged: Array<[number, number]> = [];

    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1] + 1) {
        last[1] = Math.max(last[1], range[1]);
      } else {
        merged.push(range);
      }
    }

    const result: CollapsedSegment[] = [];
    let cursor = 0;
    for (const [start, end] of merged) {
      if (start > cursor) result.push({ kind: "skip", skipped: start - cursor });
      result.push({ kind: "hunk", lines: diff.slice(start, end + 1) });
      cursor = end + 1;
    }
    if (cursor < diff.length) result.push({ kind: "skip", skipped: diff.length - cursor });
    return result;
  }

  function tone(kind: LineKind): { bg: string; gutter: string; gutterColor: string } {
    switch (kind) {
      case "add":
        return {
          bg: "bg-[color:var(--color-diff-add-bg)]",
          gutter: "+",
          gutterColor: "text-[color:var(--color-diff-add)]",
        };
      case "remove":
        return {
          bg: "bg-[color:var(--color-diff-remove-bg)]",
          gutter: "-",
          gutterColor: "text-[color:var(--color-diff-remove)]",
        };
      default:
        return { bg: "", gutter: " ", gutterColor: "text-[color:var(--color-fg-faint)]" };
    }
  }

  function highlightedContent(line: DiffLine): string | null {
    if (!highlighted) return null;
    if (line.kind === "remove" && line.oldLine !== null) return highlighted.old[line.oldLine - 1] ?? null;
    if (line.kind === "add" && line.newLine !== null) return highlighted.neu[line.newLine - 1] ?? null;
    if (line.kind === "context" && line.newLine !== null) return highlighted.neu[line.newLine - 1] ?? null;
    return null;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="type-code overflow-x-auto overscroll-x-contain rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-code-bg)] font-mono text-[color:var(--color-code-fg)]" class:full-diff={full} role={full ? "region" : undefined} aria-label={full ? "File changes" : undefined} tabindex={full ? 0 : undefined}>
  {#if full}
    <div class="min-w-max">
      {#each runs as run}
        {@const t = tone(run.kind)}
        {@const content = highlightedRun(run)}
        <div class={`flex gap-1 px-1 ${t.bg}`} data-diff-run={run.kind} data-diff-count={run.count}>
          <pre style:width={gutterWidth} class="m-0 shrink-0 select-none pr-1 text-right tabular-nums text-[color:var(--color-fg-faint)]" aria-hidden="true">{runLineNumbers(run)}</pre>
          <pre class={`m-0 w-3 shrink-0 select-none text-center ${t.gutterColor}`} aria-label={run.kind === "add" ? "added" : run.kind === "remove" ? "removed" : undefined} aria-hidden={run.kind === "context"}>{`${t.gutter}\n`.repeat(run.count - 1) + t.gutter}</pre>
          <pre class="m-0 flex-1" data-diff-code>{#if content !== null}{@html content}{:else}{run.text.replace(/\r?\n$/, "")}{/if}</pre>
        </div>
      {/each}
    </div>
  {:else}
  {#each segments as segment}
    {#if segment.kind === "hunk"}
      {#each segment.lines ?? [] as line}
        {@const t = tone(line.kind)}
        {@const content = highlightedContent(line)}
        <div class={`flex items-start gap-1 px-1 ${t.bg}`} data-diff-line={line.kind}>
          <span class={`w-3 shrink-0 select-none text-center tabular-nums ${t.gutterColor}`} aria-label={line.kind === "add" ? "added" : line.kind === "remove" ? "removed" : undefined} aria-hidden={line.kind === "context"}>{t.gutter}</span>
          {#if content}
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">{@html content}</span>
          {:else}
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-[color:var(--color-code-fg)]">{line.text || " "}</span>
          {/if}
        </div>
      {/each}
    {:else}
      <div class="type-label uppercase tracking-[0.08em] border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 py-0.5 text-[color:var(--color-fg-faint)]">
        … {segment.skipped} unchanged
      </div>
    {/if}
  {/each}
  {/if}
</div>

<style>
  .full-diff:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
  }

  pre {
    font: inherit;
  }
</style>
