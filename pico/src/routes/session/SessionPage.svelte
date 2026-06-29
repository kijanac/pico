<script lang="ts">
  import ChatSessionScreen from "@/features/chat/ChatSessionScreen.svelte";

  let { hostId, id }: { hostId: string; id: string } = $props();
</script>

{#key `${hostId}:${id}`}
  <ChatSessionScreen {hostId} sessionId={id} />
{/key}
