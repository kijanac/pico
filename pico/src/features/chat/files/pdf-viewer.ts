import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { pdfFileUrl } from "./pdf-url";

GlobalWorkerOptions.workerSrc = workerUrl;

export function attachPdfViewer(
  container: HTMLDivElement,
  viewerElement: HTMLDivElement,
  path: string,
  onPage: (page: number, total: number) => void,
  onFailure: (message: string) => void,
) {
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2, externalLinkRel: "noopener noreferrer" });
  const viewer = new PDFViewer({
    container,
    viewer: viewerElement,
    eventBus,
    linkService,
    maxCanvasPixels: Math.ceil(container.clientWidth * container.clientHeight * (window.devicePixelRatio || 1) ** 2),
  });
  linkService.setViewer(viewer);
  let destroyed = false;
  let loading: PDFDocumentLoadingTask | undefined;
  eventBus.on("pagesinit", () => {
    viewer.currentScaleValue = "page-width";
    onPage(1, viewer.pagesCount);
  });
  eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => onPage(pageNumber, viewer.pagesCount));
  eventBus.on("pagerendered", ({ error }: { error?: Error }) => {
    if (error && !destroyed) onFailure("this PDF page couldn't be rendered");
  });
  const resize = new ResizeObserver(() => {
    if (!destroyed && viewer.pagesCount > 0 && viewer.currentScaleValue === "page-width") viewer.currentScaleValue = "page-width";
  });
  resize.observe(container);
  loading = getDocument({
    url: pdfFileUrl(path),
    cMapUrl: "/pdf-assets/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdf-assets/standard_fonts/",
    wasmUrl: "/pdf-assets/wasm/",
  });
  loading.onPassword = () => {
    if (!destroyed) onFailure("this PDF needs a password; download it to open it in a PDF app");
    void loading?.destroy();
  };
  void loading.promise.then((document) => {
    if (destroyed) return;
    linkService.setDocument(document);
    viewer.setDocument(document);
  }).catch(() => {
    if (!destroyed) onFailure("couldn't load this PDF; try downloading it instead");
  });

  return {
    page(number: number) {
      if (viewer.pagesCount) viewer.currentPageNumber = Math.max(1, Math.min(number, viewer.pagesCount));
    },
    zoom(direction: "in" | "out") {
      if (!viewer.pagesCount) return;
      if (direction === "in") viewer.increaseScale();
      else viewer.decreaseScale();
    },
    destroy() {
      destroyed = true;
      resize.disconnect();
      viewer.setDocument(null);
      linkService.setDocument(null);
      void loading?.destroy();
    },
  };
}
