export function createMarkdownStream(renderer: { reset: () => void; write: (text: string) => void; end: () => void }) {
  let fed = "";
  let ended = false;
  let initialized = false;

  return (text: string, done: boolean) => {
    if (!initialized || !text.startsWith(fed) || (ended && (text !== fed || !done))) {
      renderer.reset();
      fed = "";
      ended = false;
      initialized = true;
    }
    if (text.length > fed.length) renderer.write(text.slice(fed.length));
    fed = text;
    if (done && !ended) {
      renderer.end();
      ended = true;
    }
  };
}
