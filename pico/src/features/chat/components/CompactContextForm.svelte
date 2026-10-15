<script lang="ts">
  import { compactSession } from "@/features/chat/api";
  import { shortFailureText } from "@/shared/lib/host-issues";
  import { runRpc } from "@/shared/lib/rpc-client";
  import { Button } from "@/shared/ui/button";
  import { Textarea } from "@/shared/ui/textarea";

  let { sessionId, disabled = false, label = "compact now", onStart, onError }: { sessionId: string; disabled?: boolean; label?: string; onStart: () => void; onError: (message: string) => void } = $props();

  let instructions = $state("");
  let submitting = $state(false);

  function compact(): void {
    if (disabled || submitting) return;
    submitting = true;
    const customInstructions = instructions;
    onStart();
    void runRpc(compactSession(sessionId, customInstructions)).catch((error) => {
      onError(`compaction failed · ${shortFailureText(error)}`);
    }).finally(() => { submitting = false; });
  }
</script>

<div class="space-y-3 px-3 py-3">
  <label class="block">
    <span class="label mb-1.5 block">optional instructions</span>
    <Textarea data-keyboard-editor bind:value={instructions} rows={4} placeholder="Preserve decisions, TODOs, file paths, and open questions…" class="type-input" />
  </label>
  <Button type="button" variant="default" disabled={disabled || submitting} onclick={compact} class="w-full bg-[color:var(--color-accent)] text-[color:var(--color-on-accent)] hover:bg-[color:var(--color-accent)] active:opacity-80">
    {label}
  </Button>
</div>
