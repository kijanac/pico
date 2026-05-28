import { Show, createSignal, type JSX } from "solid-js";
import { Loader2 } from "lucide-solid";
import { compactSession } from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";
import type { ActionErrorHandler } from "./types";

export default function CompactView(props: { sessionId: string; onDone: () => void; onError: ActionErrorHandler }): JSX.Element {
  const [instructions, setInstructions] = createSignal("");
  const [running, setRunning] = createSignal(false);

  async function compact() {
    if (running()) return;
    setRunning(true);
    props.onError(null);
    try {
      const baseUrl = await getBridgeUrl();
      await compactSession(baseUrl, props.sessionId, instructions());
      props.onDone();
    } catch (e) {
      props.onError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div class="space-y-3 px-3 py-3">
      <p class="text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
        Compaction summarizes older context for future model turns. The full session history stays on disk, but future prompts use the compacted summary to save context.
      </p>
      <label class="block">
        <div class="label mb-1.5">optional instructions</div>
        <textarea
          value={instructions()}
          onInput={(e) => setInstructions(e.currentTarget.value)}
          rows="4"
          placeholder="Preserve decisions, TODOs, file paths, and open questions…"
          class="w-full resize-none rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[12.5px] text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-faint)] focus:border-[color:var(--color-border-strong)] focus:outline-none"
        />
      </label>
      <button type="button" onClick={compact} disabled={running()} class="flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--color-accent)] text-[12px] font-medium text-[color:var(--color-bg)] active:opacity-80 disabled:opacity-50">
        <Show when={running()}><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /></Show>
        {running() ? "compacting…" : "compact now"}
      </button>
    </div>
  );
}
