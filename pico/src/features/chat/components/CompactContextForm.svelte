<script lang="ts">
  import { compactSession } from "@/features/chat/api";
  import { shortFailureText } from "@/shared/lib/host-issues";
  import { runRpc } from "@/shared/lib/rpc-client";
  import { Button } from "@/shared/ui/button";
  import { Textarea } from "@/shared/ui/textarea";

  // The sheet closes at once (the transcript shows compaction running); a
  // failure is reported back to the composer.
  let { sessionId, onStart, onError }: { sessionId: string; onStart: () => void; onError: (message: string) => void } = $props();

  let instructions = $state("");

  function compact(): void {
    const customInstructions = instructions;
    onStart();
    void runRpc(compactSession(sessionId, customInstructions)).catch((error) => {
      onError(`compaction failed · ${shortFailureText(error)}`);
    });
  }
</script>

<div class="space-y-3 px-3 py-3">
  <label class="block">
    <span class="label mb-1.5 block">optional instructions</span>
    <Textarea bind:value={instructions} rows={4} placeholder="Preserve decisions, TODOs, file paths, and open questions…" class="type-copy" />
  </label>
  <Button type="button" variant="default" onclick={compact} class="w-full bg-[color:var(--color-accent)] text-[color:var(--color-on-accent)] hover:bg-[color:var(--color-accent)] active:opacity-80">
    compact now
  </Button>
</div>
