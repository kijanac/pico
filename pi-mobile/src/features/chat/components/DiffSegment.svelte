<script lang="ts">
  import { diffLines } from "diff";
  import { highlightLines, inferLangFromPath } from "@/shared/lib/highlighter";

  let { oldText, newText, path }: { oldText: string; newText: string; path: string } = $props();

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

  const lines = $derived(toDiffLines(oldText, newText));
  const segments = $derived(collapseContext(lines));

  let highlighted = $state<{ old: string[]; neu: string[] } | null>(null);

  $effect(() => {
    const lang = inferLangFromPath(path);
    const oldCode = oldText;
    const newCode = newText;
    highlighted = null;
    if (!lang) return;

    let cancelled = false;
    void (async () => {
      const [oldLines, newLines] = await Promise.all([
        highlightLines(oldCode, lang),
        highlightLines(newCode, lang),
      ]);
      if (cancelled || !oldLines || !newLines) return;
      highlighted = { old: oldLines, neu: newLines };
    })();

    return () => {
      cancelled = true;
    };
  });

  function toDiffLines(oldValue: string, newValue: string): DiffLine[] {
    const chunks = diffLines(oldValue, newValue);
    const out: DiffLine[] = [];
    let oldNo = 0;
    let newNo = 0;

    for (const chunk of chunks) {
      const chunkLines = chunk.value.split("\n");
      if (chunkLines.length > 0 && chunkLines[chunkLines.length - 1] === "") {
        chunkLines.pop();
      }
      const kind: LineKind = chunk.added ? "add" : chunk.removed ? "remove" : "context";

      for (const text of chunkLines) {
        if (kind === "add") {
          newNo += 1;
          out.push({ kind, oldLine: null, newLine: newNo, text });
        } else if (kind === "remove") {
          oldNo += 1;
          out.push({ kind, oldLine: oldNo, newLine: null, text });
        } else {
          oldNo += 1;
          newNo += 1;
          out.push({ kind, oldLine: oldNo, newLine: newNo, text });
        }
      }
    }

    return out;
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

<div class="type-code overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] font-mono">
  {#each segments as segment}
    {#if segment.kind === "hunk"}
      {#each segment.lines ?? [] as line}
        {@const t = tone(line.kind)}
        {@const content = highlightedContent(line)}
        <div class={`flex items-start gap-1 px-1 ${t.bg}`}>
          <span class={`w-3 shrink-0 select-none text-center tabular-nums ${t.gutterColor}`} aria-hidden="true">{t.gutter}</span>
          {#if content}
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">{@html content}</span>
          {:else}
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-[color:var(--color-fg)]">{line.text || " "}</span>
          {/if}
        </div>
      {/each}
    {:else}
      <div class="type-label uppercase tracking-[0.08em] border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 py-0.5 text-[color:var(--color-fg-faint)]">
        … {segment.skipped} unchanged
      </div>
    {/if}
  {/each}
</div>
