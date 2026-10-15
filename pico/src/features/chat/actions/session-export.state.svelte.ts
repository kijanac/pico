import { Effect } from "effect";
import { exportSessionHtml } from "@/features/chat/api";
import { hostIssueSummary } from "@/shared/lib/host-issues";
import { createExportTask, type ExportTask } from "./export-task";

let task = $state.raw<ExportTask<File> | null>(null);
let sharing = $state(false);
let deliveryError = $state<string | null>(null);
let downloadUrl: string | null = null;

const exports = createExportTask({
  prepare: exportSessionHtml,
  describe: hostIssueSummary,
  commit: (next) => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    deliveryError = null;
    task = next;
  },
});

function start(sessionId: string, title: string): void {
  if (sharing) return;
  Effect.runFork(exports.start({ sessionId, title }));
}

async function deliver(): Promise<void> {
  if (task?.status !== "ready" || sharing) return;
  const file = task.file;
  sharing = true;
  deliveryError = null;
  try {
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    downloadUrl ??= URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = file.name;
    link.click();
  } catch (error) {
    deliveryError = hostIssueSummary(error);
  } finally {
    sharing = false;
  }
}

export const sessionExportState = {
  get task() { return task; },
  get busy() { return task?.status === "preparing" || sharing; },
  get sharing() { return sharing; },
  get deliveryError() { return deliveryError; },
  start,
  deliver,
  dismiss: () => { if (!sharing) exports.dismiss(); },
};
