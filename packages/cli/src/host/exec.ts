import { Command } from "@effect/platform";
import { Effect, Stream } from "effect";

export interface RunOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const make = (command: string, args: readonly string[], cwd?: string) => {
  const base = Command.make(command, ...args);
  return cwd ? Command.workingDirectory(base, cwd) : base;
};

// Total: spawn failure or timeout yields a RunResult (exitCode -1) rather than a
// failed Effect. Callers branch on exitCode/timedOut.
export const run = (command: string, args: readonly string[], options: RunOptions = {}) => {
  const captured = Effect.scoped(
    Effect.gen(function* () {
      const proc = yield* Command.start(make(command, args, options.cwd));
      const [exitCode, stdout, stderr] = yield* Effect.all(
        [
          proc.exitCode,
          proc.stdout.pipe(Stream.decodeText(), Stream.mkString),
          proc.stderr.pipe(Stream.decodeText(), Stream.mkString),
        ],
        { concurrency: 3 },
      );
      return { exitCode, stdout, stderr, timedOut: false } satisfies RunResult;
    }),
  ).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        exitCode: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: false,
      } satisfies RunResult),
    ),
  );

  return options.timeoutMs === undefined
    ? captured
    : Effect.timeoutTo(captured, {
        duration: `${options.timeoutMs} millis`,
        onSuccess: (result): RunResult => result,
        onTimeout: (): RunResult => ({ exitCode: -1, stdout: "", stderr: "", timedOut: true }),
      });
};

export const runInherit = (command: string, args: readonly string[], options: RunOptions = {}) => {
  const cmd = make(command, args, options.cwd).pipe(
    Command.stdin("inherit"),
    Command.stdout("inherit"),
    Command.stderr("inherit"),
  );
  const ran = Effect.scoped(Command.start(cmd).pipe(Effect.flatMap((proc) => proc.exitCode))).pipe(
    Effect.catchAll(() => Effect.succeed(-1)),
  );
  return options.timeoutMs === undefined
    ? ran
    : Effect.timeoutTo(ran, {
        duration: `${options.timeoutMs} millis`,
        onSuccess: (code): number => code,
        onTimeout: (): number => -1,
      });
};

export const commandExists = (command: string, args: readonly string[] = ["--version"]) =>
  run(command, args, { timeoutMs: 5_000 }).pipe(Effect.map((result) => result.exitCode === 0));

export const runOutput = (result: RunResult): string => result.stdout.trim() || result.stderr.trim();

export const commandLine = (command: string, args: readonly string[]): string =>
  [command, ...args].map(shellQuote).join(" ");

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
