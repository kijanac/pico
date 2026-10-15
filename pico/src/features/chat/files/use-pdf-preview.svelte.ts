import type { attachPdfViewer } from "./pdf-viewer";

export function usePdfPreview(elements: () => { container: HTMLDivElement | null; viewer: HTMLDivElement | null; path: string }) {
  let page = $state(1);
  let total = $state(0);
  let failure = $state<string | null>(null);
  let controls = $state<ReturnType<typeof attachPdfViewer> | null>(null);

  $effect(() => {
    const { container, viewer, path } = elements();
    if (!container || !viewer) return;
    page = 1;
    total = 0;
    failure = null;
    let disposed = false;
    let attached: ReturnType<typeof attachPdfViewer> | undefined;
    void import("./pdf-viewer").then(({ attachPdfViewer }) => {
      if (disposed) return;
      attached = attachPdfViewer(container, viewer, path, (nextPage, pages) => {
        if (disposed) return;
        page = nextPage;
        total = pages;
      }, (message) => {
        if (!disposed) failure = message;
      });
      controls = attached;
    }).catch(() => {
      if (!disposed) failure = "couldn't start the PDF viewer";
    });
    return () => {
      disposed = true;
      attached?.destroy();
      controls = null;
    };
  });

  return {
    get page() { return page; },
    get total() { return total; },
    get failure() { return failure; },
    next() { controls?.page(page + 1); },
    previous() { controls?.page(page - 1); },
    zoomIn() { controls?.zoom("in"); },
    zoomOut() { controls?.zoom("out"); },
  };
}
