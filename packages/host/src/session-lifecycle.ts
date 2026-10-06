// Persistence behavior is a host concern, independent of how a runtime is
// transported or which UI currently owns it.
export type SessionRuntimeLifecycle =
  | { readonly kind: "durable" }
  | { readonly kind: "presence" };
