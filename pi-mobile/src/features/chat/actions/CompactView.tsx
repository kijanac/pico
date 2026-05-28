import { Show, createSignal, type JSX } from "solid-js";
import { Loader2 } from "lucide-solid";
import { compactSession } from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";
import { Button } from "~/components/ui/button";
import { TextField, TextFieldLabel, TextFieldTextArea } from "~/components/ui/text-field";
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
      <TextField>
        <TextFieldLabel>optional instructions</TextFieldLabel>
        <TextFieldTextArea
          value={instructions()}
          onInput={(e) => setInstructions(e.currentTarget.value)}
          rows="4"
          placeholder="Preserve decisions, TODOs, file paths, and open questions…"
          class="text-[12.5px]"
        />
      </TextField>
      <Button type="button" variant="accent" onClick={compact} disabled={running()} class="w-full">
        <Show when={running()}><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /></Show>
        {running() ? "compacting…" : "compact now"}
      </Button>
    </div>
  );
}
