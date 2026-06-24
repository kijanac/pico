<script lang="ts">
  import ProviderAuthView from "@/features/auth/ProviderAuthView.svelte";

  let {
    onError,
    onConfigured,
  }: {
    onError: (message: string | null) => void;
    onConfigured?: () => void;
  } = $props();
</script>

<ProviderAuthView {onError} {onConfigured} class="py-1" />
