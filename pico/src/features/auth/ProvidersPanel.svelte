<script lang="ts">
  import ProviderAuthView from "./ProviderAuthView.svelte";

  let error = $state<string | null>(null);
</script>

{#if error}
  <p class="type-meta px-3 pt-3 text-[color:var(--color-danger)]" role="alert">{error}</p>
{/if}
<ProviderAuthView onError={(message) => (error = message)} showEmpty={error === null} class="px-3 py-3" />
