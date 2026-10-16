import { readFile } from "@/features/chat/api";
import { shortFailureText } from "@/shared/lib/host-issues";
import { describeReadFailure, type FileRequest } from "./file-links";
import { useCachedRead } from "./use-cached-read.svelte";

const RECENT_FILES = 3;

export function useFile(request: () => FileRequest | null, active: () => boolean = () => true) {
  const read = useCachedRead(() => {
    const wanted = request();
    return wanted ? { key: JSON.stringify([wanted.path, wanted.relativeTo]), read: readFile(wanted.path, wanted.relativeTo) } : null;
  }, active, { capacity: RECENT_FILES });

  return {
    get file() { return read.value; },
    get failure() { return read.failure === null ? null : describeReadFailure(shortFailureText(read.failure)); },
    retry: read.retry,
  };
}
