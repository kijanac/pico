<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as smd from "streaming-markdown";
  import { highlightToHtml } from "@/shared/lib/highlighter";
  import { fileLinkClicks, isFollowableHref, localFilePath } from "@/features/chat/files/file-links";
  import { createMarkdownStream } from "./markdown-stream";

  let { text, done = false, horizontalScroll = false, class: className = "" }: { text: string; done?: boolean; horizontalScroll?: boolean; class?: string } = $props();

  let root = $state<HTMLDivElement | null>(null);
  let parser: ReturnType<typeof smd.parser> | null = null;

  interface ActiveFence {
    preEl: HTMLPreElement;
    codeEl: HTMLElement;
    buffer: string;
    lang: string | null;
  }

  function wrapScrollRegion(element: Element, className: string, label: string): void {
    const wrapper = document.createElement("div");
    wrapper.className = className;
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", label);
    element.replaceWith(wrapper);
    wrapper.appendChild(element);
  }

  function makeRenderer(target: HTMLElement) {
    const def = smd.default_renderer(target);
    const stack: number[] = [];
    let active: ActiveFence | null = null;

    return {
      data: def.data,

      add_token(data: typeof def.data, type: smd.Token) {
        smd.default_add_token(data, type);
        stack.push(type);

        if (horizontalScroll && type === smd.TABLE) {
          wrapScrollRegion(data.nodes[data.index], "markdown-table-scroll", "Table");
        }

        if (horizontalScroll && (type === smd.CODE_FENCE || type === smd.CODE_BLOCK)) {
          wrapScrollRegion(data.nodes[data.index].parentElement!, "markdown-code-scroll", "Code block");
        }

        if (type === smd.CODE_FENCE) {
          const codeEl = data.nodes[data.index] as HTMLElement;
          const preEl = codeEl.parentElement as HTMLPreElement;
          active = { preEl, codeEl, buffer: "", lang: null };
        }
      },

      end_token(data: typeof def.data) {
        const finished = stack.pop();
        smd.default_end_token(data);

        if (finished === smd.CODE_FENCE && active) {
          const fence = active;
          active = null;
          void (async () => {
            const html = await highlightToHtml(fence.buffer, fence.lang);
            if (!html || !fence.preEl.isConnected || fence.codeEl.parentElement !== fence.preEl) return;
            const wrapper = document.createElement("div");
            wrapper.innerHTML = html;
            const newPre = wrapper.firstElementChild as HTMLElement | null;
            if (newPre) fence.preEl.replaceWith(newPre);
          })();
        }
      },

      add_text(data: typeof def.data, chunk: string) {
        smd.default_add_text(data, chunk);
        if (active && stack[stack.length - 1] === smd.CODE_FENCE) {
          active.buffer += chunk;
        }
      },

      set_attr(data: typeof def.data, type: smd.Attr, value: string) {
        if (type === smd.SRC && localFilePath(value)) {
          const image = data.nodes[data.index];
          const link = document.createElement("a");
          link.setAttribute("href", value);
          link.textContent = image.textContent ? `open image · ${image.textContent}` : "open image";
          image.replaceWith(link);
          data.nodes[data.index] = link;
          return;
        }
        if (type === smd.SRC && !isFollowableHref(value)) return;
        if (type === smd.HREF) {
          if (!isFollowableHref(value)) return;
          if (/^https?:/i.test(value)) {
            data.nodes[data.index].setAttribute("target", "_blank");
            data.nodes[data.index].setAttribute("rel", "noopener noreferrer");
          }
        }
        smd.default_set_attr(data, type, value);
        if (active && type === smd.LANG) active.lang = value;
      },
    };
  }

  const sync = createMarkdownStream({
    reset() {
      if (!root) return;
      root.innerHTML = "";
      parser = smd.parser(makeRenderer(root));
    },
    write(chunk) {
      if (parser) smd.parser_write(parser, chunk);
    },
    end() {
      if (parser) smd.parser_end(parser);
    },
  });

  const openLinkedFile = fileLinkClicks();

  onMount(() => {
    root?.addEventListener("click", openLinkedFile);
    return () => root?.removeEventListener("click", openLinkedFile);
  });

  $effect(() => {
    if (!root) return;
    sync(text, done);
  });

  onDestroy(() => {
    parser = null;
  });
</script>

<div bind:this={root} class={`streaming-md ${className}`} class:horizontal-scroll={horizontalScroll}></div>

<style>
  .horizontal-scroll :global(.markdown-table-scroll),
  .horizontal-scroll :global(.markdown-code-scroll) {
    max-width: 100%;
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }

  .horizontal-scroll :global(.markdown-table-scroll:focus-visible),
  .horizontal-scroll :global(.markdown-code-scroll:focus-visible) {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
  }

  .horizontal-scroll :global(.markdown-code-scroll) {
    border-radius: var(--radius-sm);
  }

  .horizontal-scroll :global(pre) {
    width: max-content;
    min-width: 100%;
    overflow-x: visible;
  }

  .horizontal-scroll :global(table) {
    width: max-content;
    min-width: 100%;
  }

  .horizontal-scroll :global(th),
  .horizontal-scroll :global(td) {
    max-width: 32ch;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .horizontal-scroll :global(pre),
  .horizontal-scroll :global(pre code),
  .horizontal-scroll :global(pre .line) {
    white-space: pre;
    overflow-wrap: normal;
    word-break: normal;
  }
</style>
