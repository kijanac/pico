import { closeSync, openSync, readSync, statSync, watch, type FSWatcher } from "node:fs";
import { parseSessionEntries, type SessionEntry } from "@earendil-works/pi-coding-agent";

// The phone's place in a session: the entry its line ends at (null before the
// first), how many of the file's entries it has taken into account (it goes on
// only through ones saved after them), and how many it has seen (messages
// saved off its line after those are news).
export interface Cursor {
  readonly id: string | null;
  readonly since: number;
  readonly seen: number;
}

// The phone's line goes on through each entry saved after the one it ends at.
// Anything else saved is on another branch.
export const follow = (id: string | null, saved: Iterable<SessionEntry>) => {
  const line: SessionEntry[] = [];
  for (const entry of saved) {
    if (entry.parentId !== id) continue;
    id = entry.id;
    line.push(entry);
  }
  return { id, line };
};

// Messages saved off the phone's line after the ones it has seen: another pi,
// a terminal say, working elsewhere in the session. `at` is the newest one's.
export const elsewhere = (cursor: Cursor, transcript: Transcript) => {
  const line = new Set<string>();
  for (let entry = transcript.get(cursor.id); entry && transcript.position(entry.id)! >= cursor.seen; entry = transcript.get(entry.parentId)) {
    line.add(entry.id);
  }
  let messages = 0;
  let at = 0;
  for (const entry of transcript.entries.slice(cursor.seen)) {
    if (line.has(entry.id) || entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) continue;
    messages += 1;
    at = Math.max(at, Date.parse(entry.timestamp));
  }
  return messages > 0 ? { messages, at } : undefined;
};

// Reads are synchronous, so one buffer serves them all.
const chunk = Buffer.allocUnsafe(64 * 1024);

// Where the line `offset` falls in starts.
const lineStart = (path: string, offset: number) => {
  try {
    const fd = openSync(path, "r");
    try {
      for (let end = offset; end > 0; ) {
        const start = Math.max(0, end - chunk.length);
        const newline = chunk.subarray(0, readSync(fd, chunk, 0, end - start, start)).lastIndexOf(0x0a);
        if (newline >= 0) return start + newline + 1;
        end = start;
      }
      return 0;
    } finally {
      closeSync(fd);
    }
  } catch {
    return offset;
  }
};

// pi's session file, read as pi processes append to it. Any of them may: pi
// takes no lock and reads the file only when it opens it. Starts from the
// entries pi had when it opened the file (`seed`, in the file's order) and a
// size the file had by then (`from`), which may fall inside a line another pi
// was writing. A line read again is skipped by its entry's id, as is the
// header.
export const followFile = (
  path: string,
  seed: readonly SessionEntry[],
  from: number,
  opts: {
    // pi's own copy of an entry, so entries it saved aren't held twice.
    known: (id: string) => SessionEntry | undefined;
    // The file changed; read() has what was added.
    changed: () => void;
  },
) => {
  const entries = [...seed];
  const positions = new Map(entries.map((entry, i) => [entry.id, i]));
  let offset = from > 0 ? lineStart(path, from) : 0;
  let inode: number | undefined;
  let watcher: FSWatcher | undefined;
  let closed = false;

  const unwatch = () => {
    watcher?.close();
    watcher = undefined;
  };

  const watchFile = () => {
    unwatch();
    if (closed) return;
    try {
      // kqueue (macOS) re-arms a watch only once this callback returns, so a
      // read during it could miss a write saved before then.
      watcher = watch(path, { persistent: false }, () =>
        setImmediate(() => {
          if (!closed) opts.changed();
        }),
      );
      watcher.on("error", unwatch);
    } catch {
      // Not saved yet, or gone.
    }
  };

  // The entries saved since the last read, in the order they were saved.
  const read = (): SessionEntry[] => {
    const info = statSync(path, { throwIfNoEntry: false });
    if (!info) return [];
    // Replaced, or rewritten (pi rewrites a file it upgrades): read it all again.
    if (inode !== undefined && (info.ino !== inode || info.size < offset)) offset = 0;
    if (info.ino !== inode || !watcher) watchFile();
    inode = info.ino;
    // Up to the end, not the size above: anything saved before the watch began
    // is read here, anything after it is a change.
    const chunks: Buffer[] = [];
    try {
      const fd = openSync(path, "r");
      try {
        for (let n, length = 0; (n = readSync(fd, chunk, 0, chunk.length, offset + length)) > 0; length += n) {
          chunks.push(Buffer.from(chunk.subarray(0, n)));
        }
      } finally {
        closeSync(fd);
      }
    } catch {
      // Deleted since.
      return [];
    }
    const bytes = Buffer.concat(chunks);
    // pi appends whole lines: one without its newline is still being written,
    // and is read whole next time.
    const end = bytes.lastIndexOf(0x0a) + 1;
    offset += end;
    const added: SessionEntry[] = [];
    for (const parsed of parseSessionEntries(bytes.toString("utf8", 0, end))) {
      if (parsed.type === "session" || positions.has(parsed.id)) continue;
      const entry = opts.known(parsed.id) ?? parsed;
      positions.set(entry.id, entries.length);
      entries.push(entry);
      added.push(entry);
    }
    return added;
  };

  return {
    read,
    get: (id: string | null) => (id === null ? undefined : entries[positions.get(id) ?? -1]),
    position: (id: string) => positions.get(id),
    // Every entry, in the order they were saved.
    entries: entries as readonly SessionEntry[],
    close() {
      closed = true;
      unwatch();
    },
  };
};

export type Transcript = ReturnType<typeof followFile>;
