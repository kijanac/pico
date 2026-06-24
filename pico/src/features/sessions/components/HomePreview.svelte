<script lang="ts">
  import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
  import SessionsView from "@/features/sessions/components/SessionsView.svelte";
</script>

<div class="flex min-h-dvh flex-col bg-[color:var(--color-bg)]">
  <SessionsView
    sessions={sessionListState.sessions}
    refreshing={sessionListState.refreshing}
    error={sessionListState.error}
    archivedView={sessionListState.archivedView}
    visibleCount={sessionListState.visibleCount}
    interactive={false}
    onRefresh={async () => {}}
  />
</div>
