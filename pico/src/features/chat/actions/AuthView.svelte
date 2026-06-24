<script lang="ts">
  import ProviderAuthView from "@/features/auth/ProviderAuthView.svelte";
  import type { ActionErrorHandler } from "./types";

  let { onError, onConfigured }: { onError: ActionErrorHandler; onConfigured?: () => void } = $props();
</script>

<ProviderAuthView {onError} {onConfigured} class="px-3 py-3" />
