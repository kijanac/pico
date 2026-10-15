import type { FileChange } from "@pico/protocol";
import { Effect, Fiber } from "effect";
import { readFileChange } from "@/features/chat/api";
import { forkRpc } from "@/shared/lib/rpc-client";
import type { EditReview } from "./file-links";

const RECENT_CHANGES = 3;

export function useFileChange(request: () => EditReview | undefined, active: () => boolean) {
  const recent = new Map<string, FileChange>();
  let change = $state<FileChange | null>(null);
  let failed = $state(false);
  let revision = $state(0);

  $effect(() => {
    if (!active()) return;
    revision;
    const ref = request()?.ref;
    failed = false;
    const cached = ref?.kind === "saved" ? recent.get(ref.id) ?? null : null;
    change = cached;
    if (ref?.kind !== "saved" || cached) return;
    const id = ref.id;
    let current = true;
    const task = forkRpc(readFileChange(id).pipe(
      Effect.tap((saved) => Effect.sync(() => {
        if (!current) return;
        recent.delete(id);
        recent.set(id, saved);
        while (recent.size > RECENT_CHANGES) recent.delete(recent.keys().next().value!);
        change = saved;
      })),
      Effect.catchAll(() => Effect.sync(() => { if (current) failed = true; })),
    ));
    return () => { current = false; Effect.runFork(Fiber.interrupt(task)); };
  });

  return { get change() { return change; }, get failed() { return failed; }, retry() { revision += 1; } };
}
