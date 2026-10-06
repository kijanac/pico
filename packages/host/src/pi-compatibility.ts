import { open } from "node:fs/promises";
import {
  CURRENT_SESSION_VERSION,
  VERSION as EMBEDDED_PI_VERSION,
} from "@earendil-works/pi-coding-agent";
import { PiError } from "./session-runtime.ts";

interface ParsedPiVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export interface PiSessionBinding {
  readonly runtimeSessionId: string;
  readonly runtimeSessionFile: string;
  readonly sessionFormatVersion: number;
}

export type BackgroundCompatibility =
  | { readonly compatible: true }
  | { readonly compatible: false; readonly reason: string };

const parsePiVersion = (value: string): ParsedPiVersion | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

const embedded = parsePiVersion(EMBEDDED_PI_VERSION);
if (!embedded) throw new Error(`Pico embedded an invalid Pi version: ${EMBEDDED_PI_VERSION}`);

export const SUPPORTED_TERMINAL_PI_RANGE =
  `>=${embedded.major}.${embedded.minor}.${embedded.patch} <${embedded.major}.${embedded.minor + 1}.0`;

export const backgroundCompatibility = (terminalPiVersion: string | undefined): BackgroundCompatibility => {
  if (!terminalPiVersion) {
    return {
      compatible: false,
      reason: "Update the Pico Pi extension before moving this session to the background.",
    };
  }
  const terminal = parsePiVersion(terminalPiVersion);
  if (!terminal) {
    return {
      compatible: false,
      reason: `Pico could not understand terminal Pi version ${terminalPiVersion}.`,
    };
  }
  if (
    terminal.major !== embedded.major ||
    terminal.minor !== embedded.minor ||
    terminal.patch < embedded.patch
  ) {
    return {
      compatible: false,
      reason:
        `Background handoff supports Pi ${SUPPORTED_TERMINAL_PI_RANGE}; ` +
        `terminal Pi is ${terminalPiVersion} and Pico embeds ${EMBEDDED_PI_VERSION}.`,
    };
  }
  return { compatible: true };
};

export const parsePiSessionBinding = async (
  runtimeSessionFile: string,
  expectedSessionId: string,
): Promise<PiSessionBinding> => {
  const file = await open(runtimeSessionFile, "r");
  try {
    const buffer = Buffer.alloc(16 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
    if (newline < 0) {
      throw new PiError({ message: "Pi session header is missing or too large" });
    }
    const value: unknown = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new PiError({ message: "Pi session header is invalid" });
    }
    const header = value as Record<string, unknown>;
    if (header.type !== "session" || typeof header.id !== "string" || !Number.isInteger(header.version)) {
      throw new PiError({ message: "Pi session header is invalid" });
    }
    if (header.id !== expectedSessionId) {
      throw new PiError({ message: "Attached session identity does not match its Pi JSONL" });
    }
    if (header.version !== CURRENT_SESSION_VERSION) {
      throw new PiError({
        message:
          `Background handoff requires Pi session format ${CURRENT_SESSION_VERSION}; ` +
          `this session uses format ${String(header.version)}.`,
      });
    }
    return {
      runtimeSessionId: header.id,
      runtimeSessionFile,
      sessionFormatVersion: header.version,
    };
  } catch (error) {
    if (error instanceof PiError) throw error;
    throw new PiError({ message: `Could not read Pi session header: ${String(error)}`, cause: error });
  } finally {
    await file.close();
  }
};

export { EMBEDDED_PI_VERSION };
