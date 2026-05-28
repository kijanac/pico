import { readdirSync, readFileSync, statSync } from "node:fs";
import { sep as PATH_SEP } from "node:path";
import { homedir } from "node:os";

/**
 * Built-in TUI slash commands (/tree, /model, /settings, etc.) are not
 * executable through the pi SDK prompt path — the model sees them as literal
 * text. Only prompt templates, skills, and extension commands should be shown
 * in the mobile insertion palette until we implement native mobile actions for
 * specific commands.
 */
const BUILTIN_COMMANDS: Array<{
  name: string;
  description: string;
  takesArgs?: boolean;
}> = [];

export interface CommandEntry {
  kind: "builtin" | "prompt" | "skill";
  name: string;
  description: string;
  /** True if the command accepts trailing arguments. */
  takesArgs?: boolean;
  /** Source path for diagnostics (prompts/skills only). */
  source?: string;
}

/**
 * Parse a tiny subset of YAML frontmatter: a `---` fenced header at the
 * top of a markdown file with `key: value` lines. Returns an empty
 * object if no frontmatter is present. We don't need a real YAML parser
 * because the only field we care about is `description`.
 */
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

function readFileSyncUtf8(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function loadPromptTemplates(): CommandEntry[] {
  const dir = `${homedir()}${PATH_SEP}.pi${PATH_SEP}agent${PATH_SEP}prompts`;
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const out: CommandEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const name = file.slice(0, -3);
    try {
      const path = `${dir}${PATH_SEP}${file}`;
      const text = readFileSyncUtf8(path);
      if (text === null) continue;
      const { meta, body } = parseFrontmatter(text);
      const description = meta.description || firstNonEmptyLine(body) || name;
      out.push({
        kind: "prompt",
        name,
        description,
        // All templates support $1 / $@ — surface as args-capable.
        takesArgs: true,
        source: path,
      });
    } catch {
      // Skip malformed files.
    }
  }
  return out;
}

function loadSkills(): CommandEntry[] {
  const dir = `${homedir()}${PATH_SEP}.pi${PATH_SEP}agent${PATH_SEP}skills`;
  let subdirs: string[];
  try {
    subdirs = readdirSync(dir);
  } catch {
    return [];
  }
  const out: CommandEntry[] = [];
  for (const skillDir of subdirs) {
    if (skillDir.startsWith(".")) continue;
    const skillPath = `${dir}${PATH_SEP}${skillDir}`;
    let stat;
    try {
      stat = statSync(skillPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const skillFile = `${skillPath}${PATH_SEP}SKILL.md`;
    const text = readFileSyncUtf8(skillFile);
    if (text === null) continue;
    const { meta, body } = parseFrontmatter(text);
    const description = meta.description || firstNonEmptyLine(body) || skillDir;
    out.push({
      kind: "skill",
      name: `skill:${skillDir}`,
      description,
      takesArgs: true,
      source: skillFile,
    });
  }
  return out;
}

export function loadCommands(): {
  builtins: CommandEntry[];
  prompts: CommandEntry[];
  skills: CommandEntry[];
} {
  const builtins: CommandEntry[] = BUILTIN_COMMANDS.map((b) => ({
    kind: "builtin",
    name: b.name,
    description: b.description,
    takesArgs: b.takesArgs,
  }));
  return {
    builtins,
    prompts: loadPromptTemplates(),
    skills: loadSkills(),
  };
}
