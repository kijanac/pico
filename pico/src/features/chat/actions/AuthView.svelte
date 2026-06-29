<script lang="ts">
  import ProviderAuthView from "@/features/auth/ProviderAuthView.svelte";
  import type { ActionErrorHandler } from "./types";

  let { hostId, onError, onConfigured }: { hostId: string; onError: ActionErrorHandler; onConfigured?: () => void } = $props();
</script>

<ProviderAuthView {hostId} {onError} {onConfigured} class="px-3 py-3" />
