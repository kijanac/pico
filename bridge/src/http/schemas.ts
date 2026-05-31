import * as v from "valibot";
import { SessionControlValueBody } from "@pi-mobile/protocol";

const NonEmptyString = v.pipe(v.string(), v.trim(), v.nonEmpty());

export const CreateBody = v.object({
  cwd: NonEmptyString,
  title: NonEmptyString,
  branch: v.optional(NonEmptyString),
});

export const PatchBody = v.object({
  title: v.optional(v.string()),
  archived: v.optional(v.boolean()),
});

export const CompactBody = v.object({
  instructions: v.optional(v.string()),
});

export const TreeJumpBody = v.object({
  entryId: v.string(),
  summarize: v.optional(v.boolean()),
});

export const AuthInputBody = v.object({ value: v.string() });

export { SessionControlValueBody };
