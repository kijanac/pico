<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as smd from "streaming-markdown";
  import { highlightToHtml } from "@/shared/lib/highlighter";

  let { text, done = false, class: className = "" }: { text: string; done?: boolean; class?: string } = $props();

  let root = $state<HTMLDivElement | null>(null);
  let parser: ReturnType<typeof smd.parser> | null = null;
  let fedLen = 0;
  let ended = false;

  interface ActiveFence {
    preEl: HTMLPreElement;
    codeEl: HTMLElement;
    buffer: string;
    lang: string | null;
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
            if (!html || !fence.preEl.isConnected) return;
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
        smd.default_set_attr(data, type, value);
        if (active && type === smd.LANG) active.lang = value;
      },
    };
  }

  function reset(): void {
    if (!root) return;
    root.innerHTML = "";
    parser = smd.parser(makeRenderer(root));
    fedLen = 0;
    ended = false;
  }

  function sync(): void {
    if (!parser) return;

    if (text.length < fedLen) reset();
    if (!parser) return;

    if (text.length > fedLen) {
      smd.parser_write(parser, text.slice(fedLen));
      fedLen = text.length;
    }

    if (done && !ended) {
      smd.parser_end(parser);
      ended = true;
    }
  }

  onMount(() => {
    reset();
    sync();
  });

  $effect(() => {
    text;
    done;
    sync();
  });

  onDestroy(() => {
    if (parser && !ended) {
      smd.parser_end(parser);
      ended = true;
    }
  });
</script>

<div bind:this={root} class={`streaming-md ${className}`}></div>
