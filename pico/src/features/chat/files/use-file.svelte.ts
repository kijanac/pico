import type { FsFile } from "@pico/protocol";
import { Effect, Fiber } from "effect";
import { readFile } from "@/features/chat/api";
import { forkRpc } from "@/shared/lib/rpc-client";
import { shortFailureText } from "@/shared/lib/host-issues";
import { describeReadFailure, type FileRequest } from "./file-links";

const RECENT_FILES = 3;

export function useFile(request: () => FileRequest | null, active: () => boolean = () => true) {
  const recent = new Map<string, FsFile>();
  let file = $state<FsFile | null>(null);
  let failure = $state<string | null>(null);
  let revision = $state(0);

  $effect(() => {
    if (!active()) return;
    revision;
    const wanted = request();
    failure = null;
    if (!wanted) { file = null; return; }
    const key = JSON.stringify([wanted.path, wanted.relativeTo]);
    file = recent.get(key) ?? null;
    let current = true;
    const task = forkRpc(readFile(wanted.path, wanted.relativeTo).pipe(
      Effect.tap((read) => Effect.sync(() => {
        if (!current) return;
        recent.delete(key);
        recent.set(key, read);
        while (recent.size > RECENT_FILES) recent.delete(recent.keys().next().value!);
        file = read;
      })),
      Effect.catchAll((caught) => Effect.sync(() => {
        if (current) failure = describeReadFailure(shortFailureText(caught));
      })),
    ));
    return () => { current = false; Effect.runFork(Fiber.interrupt(task)); };
  });

  return { get file() { return file; }, get failure() { return failure; }, retry() { revision += 1; } };
}
