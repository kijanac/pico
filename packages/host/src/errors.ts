import { Data } from "effect";

export class SessionNotFound extends Data.TaggedError("SessionNotFound")<{
  readonly id: string;
}> {}
