<script lang="ts">
  import ChatSessionScreen from "@/features/chat/ChatSessionScreen.svelte";

  let { id }: { id: string } = $props();
</script>

{#key id}
  <ChatSessionScreen sessionId={id} />
{/key}
