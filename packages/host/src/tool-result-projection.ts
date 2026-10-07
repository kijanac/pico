import type { ImageContent, TextContent, ThinkingContent, ToolCall } from "@earendil-works/pi-ai";
import { hasToolDetails, type ToolResultContent } from "@pico/protocol";

type ToolResultContentBlock = TextContent | ImageContent;
type DisplayContentBlock = ToolResultContentBlock | ThinkingContent | ToolCall;
type DisplayContent = string | readonly DisplayContentBlock[];

const toProtocolContent = (part: ToolResultContentBlock): ToolResultContent => {
  if (part.type === "text") return { type: "text", text: part.text };
  return { type: "image", data: part.data, mimeType: part.mimeType };
};

const displayContentBlock = (part: DisplayContentBlock): string => {
  switch (part.type) {
    case "text":
      return part.text;
    case "image":
      return "[image]";
    case "thinking":
      return "[thinking]";
    case "toolCall":
      return `[tool:${part.name}]`;
  }
};

export const textFromContent = (content: DisplayContent): string => {
  if (typeof content === "string") return content;
  return content.map(displayContentBlock).filter(Boolean).join(" ");
};

// Wire fields for a tool's output. The text goes once: as text content when
// there is any (what the app renders), otherwise as the plain `result`.
export const toolResultFields = (content: readonly ToolResultContentBlock[], details?: unknown) => {
  const resultContent = content.map(toProtocolContent);
  return {
    ...(resultContent.some((part) => part.type === "text") ? {} : { result: textFromContent(content) }),
    ...(resultContent.length > 0 ? { resultContent } : {}),
    ...(hasToolDetails(details) ? { details } : {}),
  };
};
