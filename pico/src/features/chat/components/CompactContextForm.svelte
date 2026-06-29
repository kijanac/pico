<script lang="ts">
  import { compactSession } from "@/features/chat/api";
  import { runOnHost } from "@/shared/lib/rpc-client";
  import { Button } from "@/shared/ui/button";
  import { Textarea } from "@/shared/ui/textarea";

  let { hostId, sessionId, onStart }: { hostId: string; sessionId: string; onStart: () => void } = $props();

  let instructions = $state("");

  function compact(): void {
    const customInstructions = instructions;
    onStart();
    void runOnHost(hostId, compactSession(sessionId, customInstructions)).catch((error) => {
      console.warn("[compact-context] compaction request failed:", error);
    });
  }
</script>

<div class="space-y-3 px-3 py-3">
  <label class="block">
    <span class="label mb-1.5 block">optional instructions</span>
    <Textarea bind:value={instructions} rows={4} placeholder="Preserve decisions, TODOs, file paths, and open questions…" class="type-copy" />
  </label>
  <Button type="button" variant="default" onclick={compact} class="w-full bg-[color:var(--color-accent)] text-[color:var(--color-bg)] hover:bg-[color:var(--color-accent)] active:opacity-80">
    compact now
  </Button>
</div>
