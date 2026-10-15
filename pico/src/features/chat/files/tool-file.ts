import { FileChangeDetails, type ToolCallMessage } from "@pico/protocol";
import { Option, Schema } from "effect";
import type { FileRequest } from "./file-links";

export function toolFile(msg: ToolCallMessage): FileRequest | null {
  if (msg.toolKind !== "builtin" || msg.tool === "bash" || !msg.args.path || msg.status === "pending" || msg.status === "running") return null;
  if (msg.tool !== "edit" || msg.status !== "ok") return { path: msg.args.path };
  const parsed = Schema.decodeUnknownOption(FileChangeDetails)(msg.details);
  const ref = Option.isSome(parsed) ? parsed.value.picoFileChange : null;
  return { path: ref?.path ?? msg.args.path, edit: { ref, args: msg.args } };
}

export function missingEditContext(request: NonNullable<FileRequest["edit"]>): string {
  switch (request.ref?.kind === "unavailable" ? request.ref.reason : null) {
    case "too_large": return "this edit was too large to save a full-file preview";
    case "not_text": return "this file wasn't text that could be saved for review";
    case "not_saved": return "the edit succeeded, but its full-file preview couldn't be saved";
    default: return "this edit has no saved full-file preview";
  }
}
