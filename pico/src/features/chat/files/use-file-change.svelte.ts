import { readFileChange } from "@/features/chat/api";
import type { EditReview } from "./file-links";
import { useCachedRead } from "./use-cached-read.svelte";

const RECENT_CHANGES = 3;

export function useFileChange(request: () => EditReview | undefined, active: () => boolean) {
  const read = useCachedRead(() => {
    const ref = request()?.ref;
    return ref?.kind === "saved" ? { key: ref.id, read: readFileChange(ref.id) } : null;
  }, active, { capacity: RECENT_CHANGES, revalidate: false });

  return { get change() { return read.value; }, get failed() { return read.failure !== null; }, retry: read.retry };
}
