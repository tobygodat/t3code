import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ForkUpdater from "./ForkUpdater.ts";

const INSTALLED = "a".repeat(40);
const TARGET = "b".repeat(40);
const OTHER = "c".repeat(40);
const SCRIPT_SOURCE = "#!/bin/sh\necho release";

interface Run {
  readonly stdout?: string;
  readonly exitCode?: number;
}

interface Scenario {
  readonly target?: string;
  /** Exit of `git merge-base --is-ancestor`. */
  readonly ancestorExit?: number;
  readonly release?: Run;
}

const encoder = new TextEncoder();

const makeHandle = ({ stdout = "", exitCode = 0 }: Run) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(4242),
    stdout: stdout.length === 0 ? Stream.empty : Stream.make(encoder.encode(stdout)),
    stderr: Stream.empty,
    all: Stream.empty,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

const respond = (scenario: Scenario, command: string, args: ReadonlyArray<string>): Run => {
  if (command === "/bin/sh") return scenario.release ?? { exitCode: 75 };
  switch (args[2]) {
    case "rev-parse":
      return { stdout: `${scenario.target ?? TARGET}\n` };
    case "merge-base":
      return { exitCode: scenario.ancestorExit ?? 0 };
    case "show":
      return { stdout: SCRIPT_SOURCE };
    default:
      return {};
  }
};

const withUpdater = <A, E>(
  scenario: Scenario,
  body: (context: {
    readonly updater: Effect.Success<ReturnType<typeof ForkUpdater.make>>;
    readonly releasesDir: string;
    readonly commands: Array<ReadonlyArray<string>>;
    readonly events: Array<readonly [string, unknown]>;
    readonly stage: (commit: string) => Effect.Effect<void, PlatformError.PlatformError>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const releasesDir = yield* fileSystem.makeTempDirectoryScoped();
    const commands: Array<ReadonlyArray<string>> = [];
    const spawner = ChildProcessSpawner.make((command) => {
      if (!ChildProcess.isStandardCommand(command)) return Effect.die("unexpected piped command");
      commands.push([command.command, ...command.args]);
      return Effect.succeed(makeHandle(respond(scenario, command.command, command.args)));
    });
    const updater = yield* ForkUpdater.make({
      repo: "/Users/toby/t3code",
      commit: INSTALLED,
      installPath: "/Users/toby/Applications/T3 Code Fork.app",
      releasesDir,
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(ElectronApp.ElectronApp, {
        quit: Effect.void,
      } as unknown as ElectronApp.ElectronApp["Service"]),
    );
    const events: Array<readonly [string, unknown]> = [];
    for (const name of [
      "checking-for-update",
      "update-available",
      "update-not-available",
      "download-progress",
      "update-downloaded",
    ]) {
      yield* updater.on(name, (payload: unknown) => {
        events.push([name, payload]);
      });
    }
    const stage = (commit: string) =>
      Effect.gen(function* () {
        const version = "0.0.1-preview.20261101.1";
        yield* fileSystem.makeDirectory(path.join(releasesDir, version));
        yield* fileSystem.writeFileString(path.join(releasesDir, version, "commit"), `${commit}\n`);
        yield* fileSystem.writeFileString(path.join(releasesDir, "pending"), `${version}\n`);
      });
    return yield* body({ updater, releasesDir, commands, events, stage });
  }).pipe(
    Effect.scoped,
    Effect.provideService(HostProcess.Environment, {
      HOME: "/Users/toby",
      PATH: "/usr/bin",
      T3CODE_HOME: "/Users/toby/.t3-fork",
    }),
    Effect.provide(NodeServices.layer),
  );

describe("ForkUpdater", () => {
  it.effect("offers origin/main's full commit and builds exactly that commit", () =>
    withUpdater(
      { release: { stdout: "Building T3 Code Fork\nnoise\nBuilt it\n", exitCode: 75 } },
      ({ updater, releasesDir, commands, events, stage }) =>
        Effect.gen(function* () {
          yield* updater.checkForUpdates;
          assert.deepStrictEqual(events, [
            ["checking-for-update", undefined],
            ["update-available", { version: "bbbbbbbbbbbb" }],
          ]);

          yield* stage(TARGET);
          yield* updater.downloadUpdate;
          assert.deepStrictEqual(events.slice(2), [
            ["download-progress", { percent: 10 }],
            ["download-progress", { percent: 90 }],
            ["update-downloaded", { version: "bbbbbbbbbbbb" }],
          ]);

          const script = `${releasesDir}/.in-app-release-desktop.sh`;
          assert.deepInclude(commands, [
            "git",
            "-C",
            "/Users/toby/t3code",
            "show",
            `${TARGET}:scripts/fork/release-desktop.sh`,
          ]);
          assert.deepStrictEqual(commands.at(-1), ["/bin/sh", script, "--ref", TARGET]);
          const fileSystem = yield* FileSystem.FileSystem;
          assert.equal(yield* fileSystem.readFileString(script), `${SCRIPT_SOURCE}\n`);
        }),
    ),
  );

  it.effect("fails a download whose staged build is not the offered commit", () =>
    withUpdater({}, ({ updater, events, stage }) =>
      Effect.gen(function* () {
        yield* updater.checkForUpdates;
        yield* stage(OTHER);
        const exit = yield* Effect.exit(updater.downloadUpdate);
        assert.isTrue(Exit.isFailure(exit));
        assert.isFalse(events.some(([name]) => name === "update-downloaded"));
      }),
    ),
  );

  it.effect("shows the script's reason when another release run holds the lock", () =>
    withUpdater({ release: { exitCode: 73 } }, ({ updater }) =>
      Effect.gen(function* () {
        yield* updater.checkForUpdates;
        const error = yield* Effect.flip(updater.downloadUpdate);
        assert.equal(error.message, "Another fork release is running. Try again when it finishes.");
      }),
    ),
  );

  it.effect("offers a staged build as downloaded without fetching", () =>
    withUpdater({}, ({ updater, commands, events, stage }) =>
      Effect.gen(function* () {
        yield* stage(OTHER);
        yield* updater.checkForUpdates;
        assert.deepStrictEqual(events.slice(1), [
          ["update-available", { version: "cccccccccccc" }],
          ["update-downloaded", { version: "cccccccccccc" }],
        ]);
        assert.deepStrictEqual(commands, []);
      }),
    ),
  );

  it.effect("fails the check when origin/main no longer contains this build", () =>
    withUpdater({ ancestorExit: 1 }, ({ updater, events }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(updater.checkForUpdates);
        assert.equal(error._tag, "ElectronUpdaterCheckForUpdatesError");
        assert.isFalse(events.some(([name]) => name === "update-available"));
      }),
    ),
  );
});
