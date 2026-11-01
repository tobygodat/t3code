import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronUpdater from "../electron/ElectronUpdater.ts";
import {
  FORK_RELEASE_FILE,
  IN_APP_RELEASE_SCRIPT_FILE,
  INSTALL_HELPER_SCRIPT,
  RELEASE_SCRIPT_PATH,
  type ForkCheck,
  type ForkRelease,
  forkVersionOf,
  installHelperEnvironment,
  isCommitSha,
  parseForkRelease,
  releaseEnvironment,
  releaseExitOf,
  releaseFailureDetail,
  releaseLineProgress,
  stagedCheck,
  targetCheck,
} from "./forkRelease.ts";

const { logInfo, logWarning } = DesktopObservability.makeComponentLogger("fork-updater");

const STDERR_TAIL_LINES = 3;

/** Carries the text DesktopUpdates shows; each public method maps it to its own updater error. */
class ForkUpdateFailure extends Schema.TaggedError<ForkUpdateFailure>()("ForkUpdateFailure", {
  detail: Schema.String,
}) {}

const fail = (detail: string) => Effect.fail(new ForkUpdateFailure({ detail }));

type Listener = (...args: ReadonlyArray<unknown>) => void;

const tailLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-STDERR_TAIL_LINES)
    .join(" ");

const ignoreSetting = Effect.fn("ForkUpdater.ignoreSetting")(function* (_value: unknown) {});

/** @public */
export const make = Effect.fn("ForkUpdater.make")(function* (release: ForkRelease) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const electronApp = yield* ElectronApp.ElectronApp;

  const listeners = new Map<string, Set<Listener>>();
  const emit = (eventName: string, payload?: unknown) =>
    Effect.sync(() => {
      for (const listener of listeners.get(eventName) ?? []) listener(payload);
    });
  // The commit this updater last offered; download builds it and install checks against it.
  const offeredRef = yield* Ref.make(Option.none<string>());
  const scriptPath = path.join(release.releasesDir, IN_APP_RELEASE_SCRIPT_FILE);
  const buildEnvironment = Effect.map(HostProcess.Environment, (env) =>
    releaseEnvironment(env, release.repo),
  );

  const git = Effect.fn("ForkUpdater.git")(
    function* (args: ReadonlyArray<string>) {
      const handle = yield* spawner.spawn(
        ChildProcess.make("git", ["-C", release.repo, ...args], {
          env: yield* buildEnvironment,
          extendEnv: false,
          stdin: "ignore",
        }),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { exitCode, stdout: stdout.trim(), stderr };
    },
    Effect.scoped,
    Effect.catch((cause) => fail(`Could not run git: ${cause.message}`)),
  );

  const gitFailure = (args: ReadonlyArray<string>, exitCode: number, stderr: string) =>
    fail(
      `git ${args[0]} failed in ${release.repo} (exit ${exitCode}). ${tailLines(stderr)}`.trim(),
    );

  const gitOutput = Effect.fn("ForkUpdater.gitOutput")(function* (args: ReadonlyArray<string>) {
    const result = yield* git(args);
    if (result.exitCode !== 0) return yield* gitFailure(args, result.exitCode, result.stderr);
    return result.stdout;
  });

  const isAncestor = Effect.fn("ForkUpdater.isAncestor")(function* (
    ancestor: string,
    descendant: string,
  ) {
    const args = ["merge-base", "--is-ancestor", ancestor, descendant];
    const result = yield* git(args);
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return yield* gitFailure(args, result.exitCode, result.stderr);
    }
    return result.exitCode === 0;
  });

  const readTrimmed = (file: string) =>
    fileSystem.readFileString(file).pipe(
      Effect.map((text) => text.trim()),
      Effect.option,
    );

  const readStagedCommit = Effect.gen(function* () {
    const version = yield* readTrimmed(path.join(release.releasesDir, "pending"));
    if (Option.isNone(version) || version.value.length === 0) return Option.none<string>();
    const commit = yield* readTrimmed(path.join(release.releasesDir, version.value, "commit"));
    return Option.filter(commit, isCommitSha);
  });

  // The script is taken from the commit being built, so app and schedule follow the same rules.
  const writeReleaseScript = Effect.fn("ForkUpdater.writeReleaseScript")(function* (
    commit: string,
  ) {
    const source = yield* gitOutput(["show", `${commit}:${RELEASE_SCRIPT_PATH}`]);
    yield* fileSystem.makeDirectory(release.releasesDir, { recursive: true }).pipe(
      Effect.andThen(fileSystem.writeFileString(scriptPath, `${source}\n`)),
      Effect.catch((cause) => fail(`Could not write ${scriptPath}: ${cause.message}`)),
    );
  });

  const requireOffered = Ref.get(offeredRef).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => fail("No fork update has been offered yet."),
        onSome: Effect.succeed,
      }),
    ),
  );

  const resolveCheck = Effect.gen(function* () {
    const staged = stagedCheck(release.commit, yield* readStagedCommit);
    if (Option.isSome(staged)) return staged.value;
    yield* gitOutput(["fetch", "--quiet", "origin", "main"]);
    const target = yield* gitOutput(["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]);
    if (!isCommitSha(target))
      return yield* fail(`git rev-parse returned "${target}" for origin/main.`);
    const descends = target === release.commit || (yield* isAncestor(release.commit, target));
    return targetCheck({ installed: release.commit, target, descends });
  });

  const reportCheck = Effect.fn("ForkUpdater.reportCheck")(function* (check: ForkCheck) {
    switch (check._tag) {
      case "UpToDate":
        return yield* emit("update-not-available");
      case "Available":
        yield* Ref.set(offeredRef, Option.some(check.fullSha));
        return yield* emit("update-available", { version: check.version });
      case "Staged":
        yield* Ref.set(offeredRef, Option.some(check.fullSha));
        yield* emit("update-available", { version: check.version });
        return yield* emit("update-downloaded", { version: check.version });
      case "NotDescendant":
        return yield* fail(
          `origin/main (${forkVersionOf(check.fullSha)}) does not contain this build's commit (${forkVersionOf(release.commit)}). The fork only updates forward.`,
        );
    }
  });

  const runRelease = Effect.fn("ForkUpdater.runRelease")(
    function* (offered: string) {
      const handle = yield* spawner.spawn(
        ChildProcess.make("/bin/sh", [scriptPath, "--ref", offered], {
          env: yield* buildEnvironment,
          extendEnv: false,
          stdin: "ignore",
        }),
      );
      const [, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach((line) => {
              const percent = releaseLineProgress(line);
              return percent === null ? Effect.void : emit("download-progress", { percent });
            }),
          ),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { exitCode, stderrTail: tailLines(stderr) };
    },
    Effect.scoped,
    Effect.catch((cause) => fail(`The fork build did not finish: ${cause.message}`)),
  );

  const download = Effect.gen(function* () {
    const offered = yield* requireOffered;
    yield* writeReleaseScript(offered);
    yield* logInfo("building fork update", { commit: offered });
    const { exitCode, stderrTail } = yield* runRelease(offered);
    const exit = releaseExitOf(exitCode);
    if (exit._tag !== "Staged") {
      return yield* fail(
        releaseFailureDetail(exit, { releasesDir: release.releasesDir, stderrTail }),
      );
    }
    const staged = yield* readStagedCommit;
    if (Option.isNone(staged) || staged.value !== offered) {
      const stagedName = Option.match(staged, { onNone: () => "nothing", onSome: forkVersionOf });
      return yield* fail(
        `The fork build staged ${stagedName}, not ${forkVersionOf(offered)}. Check for updates again.`,
      );
    }
    yield* emit("update-downloaded", { version: forkVersionOf(offered) });
  });

  const startInstallHelper = Effect.fn("ForkUpdater.startInstallHelper")(
    function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(
          "/bin/sh",
          [
            "-c",
            INSTALL_HELPER_SCRIPT,
            "t3-fork-install",
            String(process.pid),
            release.installPath,
            release.releasesDir,
            scriptPath,
            "/usr/bin/open",
            release.installPath,
          ],
          {
            env: installHelperEnvironment(yield* HostProcess.Environment),
            extendEnv: false,
            detached: true,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          },
        ),
      );
      // Unreferenced, the helper outlives this scope and the app.
      yield* Effect.asVoid(handle.unref);
      return handle.pid;
    },
    Effect.scoped,
    Effect.catch((cause) => fail(`Could not start the fork installer: ${cause.message}`)),
  );

  const install = Effect.gen(function* () {
    const offered = yield* requireOffered;
    const staged = yield* readStagedCommit;
    if (Option.isNone(staged))
      return yield* fail("No fork build is staged. Check for updates again.");
    // The schedule may have staged a newer build since; installing that still moves forward.
    if (staged.value !== offered && !(yield* isAncestor(offered, staged.value))) {
      return yield* fail(
        `The staged build ${forkVersionOf(staged.value)} is not ${forkVersionOf(offered)} or newer. Check for updates again.`,
      );
    }
    yield* writeReleaseScript(staged.value);
    const pid = yield* startInstallHelper();
    yield* logInfo("fork installer started; quitting", { pid, commit: staged.value });
    // A later macrotask: before-quit interrupts running fibers, and an interrupted
    // DesktopUpdates.install deletes its install record and restart marker.
    yield* electronApp.quit.pipe(Effect.delay(Duration.zero), Effect.forkDetach);
  });

  return ElectronUpdater.ElectronUpdater.of({
    kind: "fork",
    setFeedURL: ignoreSetting,
    setAutoDownload: ignoreSetting,
    setAutoInstallOnAppQuit: ignoreSetting,
    setChannel: ignoreSetting,
    setAllowPrerelease: ignoreSetting,
    allowDowngrade: Effect.succeed(false),
    setAllowDowngrade: ignoreSetting,
    setFullChangelog: ignoreSetting,
    setDisableDifferentialDownload: ignoreSetting,
    checkForUpdates: emit("checking-for-update").pipe(
      Effect.andThen(resolveCheck),
      Effect.flatMap(reportCheck),
      Effect.catchTags({
        ForkUpdateFailure: ({ detail }) =>
          Effect.fail(
            new ElectronUpdater.ElectronUpdaterCheckForUpdatesError({
              channel: null,
              cause: detail,
              detail,
            }),
          ),
      }),
      Effect.withSpan("ForkUpdater.checkForUpdates"),
    ),
    downloadUpdate: download.pipe(
      Effect.catchTags({
        ForkUpdateFailure: ({ detail }) =>
          Effect.fail(
            new ElectronUpdater.ElectronUpdaterDownloadUpdateError({
              channel: null,
              cause: detail,
              detail,
            }),
          ),
      }),
      Effect.withSpan("ForkUpdater.downloadUpdate"),
    ),
    quitAndInstall: Effect.fn("ForkUpdater.quitAndInstall")(function ({
      isSilent,
      isForceRunAfter,
    }) {
      return install.pipe(
        Effect.catchTags({
          ForkUpdateFailure: ({ detail }) =>
            Effect.fail(
              new ElectronUpdater.ElectronUpdaterQuitAndInstallError({
                channel: null,
                isSilent,
                isForceRunAfter,
                cause: detail,
                detail,
              }),
            ),
        }),
      );
    }),
    on: Effect.fn("ForkUpdater.on")(function (eventName, listener) {
      const untypedListener = listener as unknown as Listener;
      return Effect.acquireRelease(
        Effect.sync(() => {
          const eventListeners = listeners.get(eventName) ?? new Set<Listener>();
          eventListeners.add(untypedListener);
          listeners.set(eventName, eventListeners);
        }),
        () =>
          Effect.sync(() => {
            listeners.get(eventName)?.delete(untypedListener);
          }),
      );
    }),
  });
});

const readForkRelease = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if ((yield* HostProcess.Platform) !== "darwin") return Option.none<ForkRelease>();
  const metadata = yield* Effect.option(electronApp.metadata);
  if (Option.isNone(metadata) || !metadata.value.isPackaged) return Option.none<ForkRelease>();
  const file = path.join(metadata.value.resourcesPath, FORK_RELEASE_FILE);
  const text = yield* Effect.option(fileSystem.readFileString(file));
  if (Option.isNone(text)) return Option.none<ForkRelease>();
  const release = parseForkRelease(text.value);
  if (Option.isNone(release)) {
    yield* logWarning("ignoring an invalid fork release file; using electron-updater", { file });
  }
  return release;
});

/** Picks the updater once: the fork's when the bundle has fork-release.json, else electron-updater. */
export const layer: Layer.Layer<
  ElectronUpdater.ElectronUpdater,
  never,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ElectronApp.ElectronApp
> = Layer.unwrap(
  readForkRelease.pipe(
    Effect.map(
      Option.match({
        onNone: () => ElectronUpdater.layer,
        onSome: (release) => Layer.effect(ElectronUpdater.ElectronUpdater, make(release)),
      }),
    ),
  ),
);
