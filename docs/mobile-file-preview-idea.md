# Mobile host-file previews

## Idea

Make host-local image paths mentioned in chat clickable on Pico mobile, so a path like:

```text
/tmp/pico-ui-harness.png
```

can be tapped and opened in an in-app preview sheet.

## Motivation

Pi/Pico often produces files on the host machine during debugging or testing, then references them in assistant text. Those paths are useful on the host but inaccessible from the phone unless Pico provides a host-mediated preview flow.

## Narrow first version

- Detect local-looking image paths in assistant/tool text, such as `.png`, `.jpg`, `.jpeg`, `.webp`, and `.gif`.
- Render them as tappable links/chips in chat.
- On tap, mobile asks the active Pico host to preview that file.
- Host reads the file and returns image content only if it is safe to expose.
- Mobile opens an image preview sheet/modal with basic close/share affordances.

This does not require model/provider image-output support. It is a Pico host + mobile UI bridge for files already present on the host.

## Security constraints

Do not blindly expose arbitrary host paths.

Recommended guardrails:

- Preview only on explicit user tap; never auto-fetch local paths.
- Initially allow image file extensions only.
- Verify the file is actually an image before returning it.
- Enforce a size limit and return a clear error if too large.
- Consider warning or blocking paths outside the session cwd/workspace.
- Consider a stronger later model where only files produced/read by tools are previewable.
- Keep host auth checks identical to other Pico host APIs.

## Possible implementation shape

1. Add a host RPC/API like `previewHostFile({ sessionId, path })`.
2. Resolve the path on the host, applying path/scope/size checks.
3. Return `{ mimeType, data }` for accepted images, probably base64 like existing `ImageContent`.
4. Add mobile markdown/path detection for image-looking absolute or relative paths.
5. Add an image preview sheet in the chat UI.

## Larger follow-up

A fuller artifact system could later support generated files, thumbnails, downloads, sharing, retention, and non-image previews. The first version should stay narrowly focused on tap-to-preview host-local images.
