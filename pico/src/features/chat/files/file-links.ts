import { getContext, setContext } from "svelte";
import type { EditToolArgs, FileChangeRef } from "@pico/protocol";

export type EditReview = { ref: FileChangeRef | null; args: EditToolArgs };
export type FileRequest = { path: string; relativeTo?: string; edit?: EditReview };
type OpenFile = (path: string, edit?: EditReview) => void;

const openerKey = Symbol("open-file");

export const provideFileOpener = (open: OpenFile) => setContext(openerKey, open);
export const fileOpener = () => getContext<OpenFile | undefined>(openerKey);

const urlScheme = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
const lineNumbers = /(:\d+){1,2}$/;

export function localFilePath(href: string): string | undefined {
  const path = href.replace(/^file:(\/\/)?/i, "").replace(/[?#].*$/, "").replace(lineNumbers, "");
  if (!path || urlScheme.test(path)) return undefined;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

const followableSchemes = new Set(["http:", "https:", "mailto:", "file:"]);

export function isFollowableHref(href: string): boolean {
  try {
    return followableSchemes.has(new URL(href, "https://pico.invalid/").protocol);
  } catch {
    return false;
  }
}

const isPlainLeftClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export function fileLinkClicks(): (event: MouseEvent) => void {
  const open = fileOpener();
  return (event) => {
    if (!isPlainLeftClick(event)) return;
    const href = event.target instanceof Element ? event.target.closest("a")?.getAttribute("href") : null;
    if (href == null) return;
    if (href.startsWith("#")) return event.preventDefault();
    const path = localFilePath(href);
    if (!path || !open) return;
    event.preventDefault();
    open(path);
  };
}

const wireMessages: Record<string, string> = {
  not_found: "there's no such file",
  forbidden: "the host isn't allowed to read it",
  not_a_file: "that's a folder, not a file",
  too_large: "it's too big to show here",
  not_text: "this file format can't be previewed here",
};

export const describeReadFailure = (message: string) => wireMessages[message] ?? message;
