import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent, ThinkingContent, ToolCall } from "@earendil-works/pi-ai";
import { hasToolDetails, type ToolResultContent } from "@pico/protocol";

type ToolResultContentBlock = TextContent | ImageContent;
type DisplayContentBlock = ToolResultContentBlock | ThinkingContent | ToolCall;
type DisplayContent = string | readonly DisplayContentBlock[];

export type ProjectedToolResult = {
  text: string;
  content?: ToolResultContent[];
  details?: unknown;
};

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

export const projectToolResultContent = (
  content: readonly ToolResultContentBlock[],
): ToolResultContent[] | undefined => {
  const projected = content.map(toProtocolContent);
  return projected.length > 0 ? projected : undefined;
};

export const projectToolResult = (result: AgentToolResult<unknown>): ProjectedToolResult => {
  const content = projectToolResultContent(result.content);

  return {
    text: textFromContent(result.content),
    ...(content ? { content } : {}),
    ...(hasToolDetails(result.details) ? { details: result.details } : {}),
  };
};
