<script lang="ts">
  import { highlightToHtml } from "@/shared/lib/highlighter";

  let { text, lang }: { text: string; lang: string | null } = $props();

  let html = $state<string | null>(null);

  $effect(() => {
    const abort = new AbortController();
    html = null;
    void highlightToHtml(text, lang, abort.signal).then((highlighted) => {
      if (!abort.signal.aborted) html = highlighted;
    });
    return () => abort.abort();
  });
</script>

<div class="streaming-md">
  {#if html}
    {@html html}
  {:else}
    <pre class="whitespace-pre-wrap">{text}</pre>
  {/if}
</div>
