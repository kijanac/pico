import * as Data from "effect/Data";

export class SessionNotFound extends Data.TaggedError("SessionNotFound")<{
  readonly id: string;
}> {}
