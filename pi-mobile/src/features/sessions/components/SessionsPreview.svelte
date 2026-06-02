<script lang="ts">
  import { GitBranch, Plus, Settings as SettingsIcon } from "@lucide/svelte";
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import StatusDot from "@/shared/components/StatusDot.svelte";
  import { formatCost, relativeTime } from "@/shared/lib/format";
  import { cwdDisplayName } from "@/shared/lib/path-display";
</script>

<div class="flex min-h-dvh flex-col bg-[color:var(--color-bg)]">
  <header class="flex items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-3 py-[calc(env(safe-area-inset-top)+12px)] pb-3">
    <div class="flex items-baseline gap-2">
      <span class="text-[13px] font-medium">sessions</span>
      <span class="label">{sessionListState.sessions.length}</span>
    </div>
    <div class="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)]">
      <SettingsIcon class="size-4" />
    </div>
  </header>

  {#if sessionListState.sessions.length > 0}
    <div class="flex-1 overflow-hidden">
      {#each sessionListState.sessions as session (session.id)}
        <div class="hairline-b block px-3 py-3">
          <div class="mb-1 flex items-center gap-2">
            <StatusDot status={session.status} />
            <span class="min-w-0 flex-1 truncate text-[13px] leading-tight">{session.title}</span>
            <span class="text-[10px] tabular-nums text-[color:var(--color-fg-faint)]">{relativeTime(session.updatedAt)}</span>
          </div>
          <div class="flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
            <span class="truncate">{cwdDisplayName(session.cwd)}</span>
            {#if session.branch}
              <span class="flex shrink-0 items-center gap-1">
                <GitBranch class="size-2.5" />
                {session.branch}
              </span>
            {/if}
            <span class="ml-auto shrink-0 tabular-nums">{formatCost(session.costUsd)}</span>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="flex flex-1 items-center justify-center px-6 text-center">
      <p class="text-[12px] text-[color:var(--color-fg-faint)]">
        no sessions yet — tap <span class="text-[color:var(--color-fg-muted)]">new session</span> below.
      </p>
    </div>
  {/if}

  <div class="hairline-t sticky bottom-0 bg-[color:var(--color-bg)]/95 p-2" style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem)">
    <div class="flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-strong)] text-[12px] text-[color:var(--color-fg-muted)]">
      <Plus class="size-3.5" />
      new session
    </div>
  </div>
</div>
