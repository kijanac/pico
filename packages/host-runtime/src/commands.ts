import { sep as PATH_SEP } from "node:path";
import { homedir } from "node:os";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import type { BuiltinCommandEntry, Commands, PromptCommandEntry, SkillCommandEntry } from "@pico/protocol";

const BUILTIN_COMMANDS: Array<{
  name: string;
  description: string;
  takesArgs?: boolean;
}> = [];

function parseFrontmatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[m[1]] = value;
  }
  return { meta, body: match[2] };
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return "";
}

const readFileText = (fs: FileSystem.FileSystem, path: string) =>
  fs.readFileString(path, "utf8").pipe(Effect.option);

const loadPromptTemplates = (fs: FileSystem.FileSystem) =>
  Effect.gen(function* () {
    const dir = `${homedir()}${PATH_SEP}.pi${PATH_SEP}agent${PATH_SEP}prompts`;
    const files = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));
    const out: PromptCommandEntry[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const name = file.slice(0, -3);
      const path = `${dir}${PATH_SEP}${file}`;
      const text = yield* readFileText(fs, path);
      if (Option.isNone(text)) continue;
      const { meta, body } = parseFrontmatter(text.value);
      const description = meta.description || firstNonEmptyLine(body) || name;
      out.push({ kind: "prompt", name, description, takesArgs: true, source: path });
    }
    return out;
  });

const loadSkills = (fs: FileSystem.FileSystem) =>
  Effect.gen(function* () {
    const dir = `${homedir()}${PATH_SEP}.pi${PATH_SEP}agent${PATH_SEP}skills`;
    const subdirs = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));
    const out: SkillCommandEntry[] = [];
    for (const skillDir of subdirs) {
      if (skillDir.startsWith(".")) continue;
      const skillPath = `${dir}${PATH_SEP}${skillDir}`;
      const info = yield* fs.stat(skillPath).pipe(Effect.option);
      if (Option.isNone(info) || info.value.type !== "Directory") continue;
      const skillFile = `${skillPath}${PATH_SEP}SKILL.md`;
      const text = yield* readFileText(fs, skillFile);
      if (Option.isNone(text)) continue;
      const { meta, body } = parseFrontmatter(text.value);
      const description = meta.description || firstNonEmptyLine(body) || skillDir;
      out.push({ kind: "skill", name: `skill:${skillDir}`, description, takesArgs: true, source: skillFile });
    }
    return out;
  });

export const loadCommands = (): Effect.Effect<Commands, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const builtins: BuiltinCommandEntry[] = BUILTIN_COMMANDS.map((b) => ({
      kind: "builtin",
      name: b.name,
      description: b.description,
      takesArgs: b.takesArgs,
    }));
    const [prompts, skills] = yield* Effect.all([loadPromptTemplates(fs), loadSkills(fs)]);
    return { builtins, prompts, skills };
  });
