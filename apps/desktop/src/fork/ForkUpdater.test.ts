import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as TestClock from "effect/testing/TestClock";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ForkUpdater from "./ForkUpdater.ts";

const INSTALLED = "a".repeat(40);
const TARGET = "b".repeat(40);
const NEWER = "d".repeat(40);
/** On a line that does not contain INSTALLED, as after a rewind of origin/main. */
const OTHER = "c".repeat(40);
const ANCESTRY: ReadonlyArray<readonly [ancestor: string, descendant: string]> = [
  [INSTALLED, TARGET],
  [INSTALLED, NEWER],
  [TARGET, NEWER],
];

const scriptSourceOf = (commit: string) => `#!/bin/sh\necho ${commit}`;

interface Run {
  readonly stdout?: string;
  readonly exitCode?: number;
}

interface Scenario {
  readonly target?: string;
  /** Whether origin/main's commit is already in the checkout. */
  readonly targetPresent?: boolean;
  readonly ancestry?: typeof ANCESTRY;
  /** The release run stages this commit before it exits. */
  readonly stages?: string;
  readonly release?: Run;
  readonly lockExit?: number;
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

const isReleaseRun = (command: string, args: ReadonlyArray<string>) =>
  command === "/bin/sh" && args[0] !== "-c";

const respond = (scenario: Scenario, command: string, args: ReadonlyArray<string>): Run => {
  if (command === "/usr/bin/lockf") return { exitCode: scenario.lockExit ?? 0 };
  if (command === "/bin/sh") return isReleaseRun(command, args) ? (scenario.release ?? {}) : {};
  switch (args[2]) {
    case "ls-remote":
      return { stdout: `${scenario.target ?? TARGET}\trefs/heads/main\n` };
    case "cat-file":
      return { exitCode: (scenario.targetPresent ?? true) ? 0 : 128 };
    case "merge-base": {
      const [ancestor, descendant] = [args[4], args[5]];
      const descends =
        ancestor === descendant ||
        (scenario.ancestry ?? ANCESTRY).some(([a, d]) => a === ancestor && d === descendant);
      return { exitCode: descends ? 0 : 1 };
    }
    case "show":
      return { stdout: scriptSourceOf(args[3]?.split(":")[0] ?? "") };
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
    readonly spawned: Array<ChildProcess.StandardCommand>;
    readonly events: Array<readonly [string, unknown]>;
    readonly quitCount: () => number;
    readonly stage: (commit: string) => Effect.Effect<void, PlatformError.PlatformError>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const releasesDir = yield* fileSystem.makeTempDirectoryScoped();
    const stage = (commit: string) =>
      Effect.gen(function* () {
        const version = `0.0.1-preview.${commit.slice(0, 4)}`;
        yield* fileSystem.makeDirectory(path.join(releasesDir, version), { recursive: true });
        yield* fileSystem.writeFileString(path.join(releasesDir, version, "commit"), `${commit}\n`);
        yield* fileSystem.writeFileString(path.join(releasesDir, "pending"), `${version}\n`);
      });
    const commands: Array<ReadonlyArray<string>> = [];
    const spawned: Array<ChildProcess.StandardCommand> = [];
    const spawner = ChildProcessSpawner.make((command) => {
      if (!ChildProcess.isStandardCommand(command)) return Effect.die("unexpected piped command");
      commands.push([command.command, ...command.args]);
      spawned.push(command);
      const handle = makeHandle(respond(scenario, command.command, command.args));
      return isReleaseRun(command.command, command.args) && scenario.stages !== undefined
        ? Effect.as(stage(scenario.stages), handle)
        : Effect.succeed(handle);
    });
    let quits = 0;
    const updater = yield* ForkUpdater.make({
      repo: "/Users/toby/t3code",
      commit: INSTALLED,
      installPath: "/Users/toby/Applications/T3 Code Fork.app",
      releasesDir,
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(ElectronApp.ElectronApp, {
        quit: Effect.sync(() => {
          quits += 1;
        }),
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
    return yield* body({
      updater,
      releasesDir,
      commands,
      spawned,
      events,
      quitCount: () => quits,
      stage,
    });
  }).pipe(
    Effect.scoped,
    Effect.provideService(HostProcess.Environment, {
      HOME: "/Users/toby",
      PATH: "/usr/bin",
      T3CODE_HOME: "/Users/toby/.t3-fork",
      ELECTRON_RUN_AS_NODE: "1",
    }),
    Effect.provide(NodeServices.layer),
  );

const gitSubcommands = (commands: ReadonlyArray<ReadonlyArray<string>>) =>
  commands.filter(([command]) => command === "git").map((args) => args.slice(3).join(" "));

const installOptions = { isSilent: true, isForceRunAfter: true };

const preflight = (updater: Effect.Success<ReturnType<typeof ForkUpdater.make>>) =>
  updater.installPreflight?.(installOptions) ?? Effect.die("the fork updater has no preflight");

describe("ForkUpdater", () => {
  it.effect("offers origin/main's full commit and builds exactly that commit", () =>
    withUpdater(
      {
        stages: TARGET,
        release: { stdout: "Building T3 Code Fork\nnoise\nBuilt it\n", exitCode: 75 },
      },
      ({ updater, releasesDir, commands, events }) =>
        Effect.gen(function* () {
          yield* updater.checkForUpdates;
          assert.deepStrictEqual(events, [
            ["checking-for-update", undefined],
            ["update-available", { version: "bbbbbbbbbbbb" }],
          ]);

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
          assert.equal(yield* fileSystem.readFileString(script), `${scriptSourceOf(TARGET)}\n`);
        }),
    ),
  );

  it.effect("reads origin/main without fetching, and fetches only a commit not yet here", () =>
    Effect.gen(function* () {
      for (const [targetPresent, expected] of [
        [true, ["ls-remote origin refs/heads/main", `cat-file -e ${TARGET}^{commit}`]],
        [
          false,
          [
            "ls-remote origin refs/heads/main",
            `cat-file -e ${TARGET}^{commit}`,
            "fetch --quiet --no-write-fetch-head origin main",
          ],
        ],
      ] as const) {
        yield* withUpdater({ targetPresent }, ({ updater, commands }) =>
          Effect.gen(function* () {
            yield* updater.checkForUpdates;
            assert.deepStrictEqual(gitSubcommands(commands), [
              ...expected,
              `merge-base --is-ancestor ${INSTALLED} ${TARGET}`,
            ]);
          }),
        );
      }
    }),
  );

  it.effect("fails a download whose staged build is not the offered commit", () =>
    withUpdater({ stages: OTHER, release: { exitCode: 75 } }, ({ updater, events }) =>
      Effect.gen(function* () {
        yield* updater.checkForUpdates;
        const exit = yield* Effect.exit(updater.downloadUpdate);
        assert.isTrue(Exit.isFailure(exit));
        assert.isFalse(events.some(([name]) => name === "update-downloaded"));
      }),
    ),
  );

  it.effect("takes a staged build that contains the offered commit instead of building", () =>
    withUpdater({}, ({ updater, commands, events, stage }) =>
      Effect.gen(function* () {
        yield* updater.checkForUpdates;
        yield* stage(NEWER);
        yield* updater.downloadUpdate;
        assert.deepStrictEqual(events.at(-1), ["update-downloaded", { version: "dddddddddddd" }]);
        assert.isFalse(commands.some(([command]) => command === "/bin/sh"));
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

  it.effect("offers a newer staged build as downloaded without reading origin", () =>
    withUpdater({}, ({ updater, commands, events, stage }) =>
      Effect.gen(function* () {
        yield* stage(NEWER);
        yield* updater.checkForUpdates;
        assert.deepStrictEqual(events.slice(1), [
          ["update-available", { version: "dddddddddddd" }],
          ["update-downloaded", { version: "dddddddddddd" }],
        ]);
        assert.deepStrictEqual(gitSubcommands(commands), [
          `merge-base --is-ancestor ${INSTALLED} ${NEWER}`,
        ]);
      }),
    ),
  );

  it.effect("ignores a staged build that does not contain this build and checks origin", () =>
    withUpdater({}, ({ updater, events, stage }) =>
      Effect.gen(function* () {
        yield* stage(OTHER);
        yield* updater.checkForUpdates;
        assert.deepStrictEqual(events.slice(1), [
          ["update-available", { version: "bbbbbbbbbbbb" }],
        ]);
      }),
    ),
  );

  it.effect("fails the check when origin/main no longer contains this build", () =>
    withUpdater({ target: OTHER }, ({ updater, events }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(updater.checkForUpdates);
        assert.equal(error._tag, "ElectronUpdaterCheckForUpdatesError");
        assert.include(error.message, "only updates forward");
        assert.isFalse(events.some(([name]) => name === "update-available"));
      }),
    ),
  );

  it.effect("refuses at preflight a staged build that is not the offered commit or newer", () =>
    withUpdater({}, ({ updater, commands, quitCount, stage }) =>
      Effect.gen(function* () {
        yield* updater.checkForUpdates;
        yield* stage(OTHER);
        const error = yield* Effect.flip(preflight(updater));
        assert.equal(error._tag, "ElectronUpdaterQuitAndInstallError");
        assert.include(error.message, "No staged build is bbbbbbbbbbbb or newer");
        assert.isFalse(commands.some(([, flag]) => flag === "-c"));
        yield* TestClock.adjust(Duration.millis(1));
        assert.equal(quitCount(), 0);
      }),
    ),
  );

  it.effect("refuses at preflight while another release run holds the lock", () =>
    withUpdater({ lockExit: 75 }, ({ updater, commands, quitCount, stage }) =>
      Effect.gen(function* () {
        yield* updater.checkForUpdates;
        yield* stage(TARGET);
        const error = yield* Effect.flip(preflight(updater));
        assert.equal(error.message, "Another fork release is running. Try again when it finishes.");
        assert.isFalse(commands.some(([, flag]) => flag === "-c"));
        yield* TestClock.adjust(Duration.millis(1));
        assert.equal(quitCount(), 0);
      }),
    ),
  );

  it.effect("starts the installer for the staged build, then quits after install returns", () =>
    withUpdater({}, ({ updater, releasesDir, spawned, quitCount, stage }) =>
      Effect.gen(function* () {
        yield* updater.checkForUpdates;
        yield* stage(NEWER);
        yield* preflight(updater);
        yield* updater.quitAndInstall(installOptions);
        assert.equal(quitCount(), 0);

        const script = `${releasesDir}/.in-app-release-desktop.sh`;
        const fileSystem = yield* FileSystem.FileSystem;
        assert.equal(yield* fileSystem.readFileString(script), `${scriptSourceOf(NEWER)}\n`);
        const helper = spawned.find((command) => command.args[0] === "-c");
        assert.isDefined(helper);
        assert.equal(helper?.command, "/bin/sh");
        assert.deepStrictEqual(helper?.args.slice(3), [
          String(process.pid),
          "/Users/toby/Applications/T3 Code Fork.app",
          releasesDir,
          script,
          "/usr/bin/open",
          "/Users/toby/Applications/T3 Code Fork.app",
        ]);
        assert.isTrue(helper?.options.detached);
        assert.deepStrictEqual(helper?.options.env, {
          HOME: "/Users/toby",
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        });

        yield* TestClock.adjust(Duration.millis(1));
        assert.equal(quitCount(), 1);
      }),
    ),
  );
});
