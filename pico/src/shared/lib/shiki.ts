// Static re-exports, so the bundler keeps only these: a dynamic import of
// "shiki/core" retains its whole namespace, including the HTML serializer.
// Grammars come precompiled (@shikijs/langs-precompiled), so the raw engine
// skips translating Oniguruma regexes at runtime.
export { codeToTokens, createShikiPrimitiveAsync } from "shiki/core";
export { createJavaScriptRawEngine } from "shiki/engine/javascript";
