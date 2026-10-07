// Static re-exports, so the bundler keeps only these: a dynamic import of
// "shiki/core" retains its whole namespace, including the HTML serializer.
export { codeToTokens, createShikiPrimitiveAsync } from "shiki/core";
export { createJavaScriptRegexEngine } from "shiki/engine/javascript";
