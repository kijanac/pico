<script lang="ts">
  import { Shield, Terminal } from "@lucide/svelte";
  import type { PermissionRequest } from "@pico/protocol";
  import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
  import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
  import { Button } from "@/shared/ui/button";

  let { req }: { req: PermissionRequest } = $props();

  function choose(choice: "allow" | "deny" | "allow_session"): void {
    const sessionId = chatLogState.activeSessionId;
    const send = activeSessionState.send;
    if (!sessionId || !send) return;

    chatLogState.resolvePermission(sessionId, req.id, choice);
    send({ t: "permission_reply", id: req.id, choice });
  }

  function formatArgs(): string {
    if (req.toolKind === "builtin" && req.tool === "bash") return req.args.command;
    return JSON.stringify(req.args, null, 2);
  }
</script>

{#if req.resolved !== undefined}
  <div class="mx-3 my-2 rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-border)] px-2.5 py-1.5">
    <span class="label">{req.resolved} · {req.tool}</span>
  </div>
{:else}
  <div class="mx-3 my-2 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-accent)]/40">
    <div class="flex items-center gap-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-accent-dim)] px-3 py-2">
      <Shield class="size-3 text-[color:var(--color-accent)]" />
      <span class="type-label uppercase tracking-[0.08em] text-[color:var(--color-accent)]">permission required</span>
    </div>

    <div class="bg-[color:var(--color-surface)] p-3">
      <div class="mb-2 flex items-center gap-2 text-[color:var(--color-fg-muted)]">
        <Terminal class="size-3" />
        <span class="label">{req.tool}</span>
      </div>
      <pre class="type-code mb-3 overflow-x-auto rounded-[var(--radius-sm)] bg-[color:var(--color-bg)] p-2">{formatArgs()}</pre>
      {#if req.rationale}
        <p class="type-copy mb-3 text-[color:var(--color-fg-muted)]">{req.rationale}</p>
      {/if}

      <div class="grid grid-cols-3 gap-1.5">
        <Button type="button" variant="outline" size="sm" onclick={() => choose("deny")} class="type-meta rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface-2)]">deny</Button>
        <Button type="button" variant="outline" size="sm" onclick={() => choose("allow")} class="type-meta rounded-[var(--radius-sm)] border-[color:var(--color-border-strong)] text-[color:var(--color-fg)] active:bg-[color:var(--color-surface-2)]">allow once</Button>
        <Button type="button" size="sm" onclick={() => choose("allow_session")} class="type-meta rounded-[var(--radius-sm)] active:opacity-80">allow for session</Button>
      </div>
    </div>
  </div>
{/if}
