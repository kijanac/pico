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

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="streaming-md code-file" role="region" aria-label="File contents" tabindex="0">
  {#if html}
    {@html html}
  {:else}
    <pre>{text}</pre>
  {/if}
</div>

<style>
  .code-file {
    max-width: 100%;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    border-radius: var(--radius-sm);
  }

  .code-file:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
  }

  .code-file :global(pre) {
    width: max-content;
    min-width: 100%;
    overflow-x: visible;
  }

  .code-file :global(pre),
  .code-file :global(pre code),
  .code-file :global(pre .line) {
    white-space: pre;
    overflow-wrap: normal;
    word-break: normal;
  }
</style>
