import { getContext, setContext } from "svelte";

export type FileRequest = { path: string; relativeTo?: string };
type OpenFile = (path: string) => void;

const openerKey = Symbol("open-file");

export const provideFileOpener = (open: OpenFile) => setContext(openerKey, open);

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
  const open = getContext<OpenFile | undefined>(openerKey);
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
  not_text: "it isn't a text file",
};

export const describeReadFailure = (message: string) => wireMessages[message] ?? message;
