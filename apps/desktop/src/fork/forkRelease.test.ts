import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  INSTALL_HELPER_SCRIPT,
  type ReleaseExit,
  parseForkRelease,
  releaseEnvironment,
  releaseExitOf,
  stagedCheck,
  targetCheck,
} from "./forkRelease.ts";

const INSTALLED = "a".repeat(40);
const TARGET = "b".repeat(40);

describe("forkRelease", () => {
  it("offers only forward moves from origin/main", () => {
    const rows = [
      { target: INSTALLED, descends: true, expected: { _tag: "UpToDate" } },
      {
        target: TARGET,
        descends: true,
        expected: { _tag: "Available", fullSha: TARGET, version: "bbbbbbbbbbbb" },
      },
      { target: TARGET, descends: false, expected: { _tag: "NotDescendant", fullSha: TARGET } },
    ] as const;
    for (const row of rows) {
      assert.deepStrictEqual(targetCheck({ installed: INSTALLED, ...row }), row.expected);
    }
  });

  it("lets a staged build other than this one win", () => {
    assert.deepStrictEqual(
      stagedCheck(INSTALLED, Option.some(TARGET)),
      Option.some({ _tag: "Staged", fullSha: TARGET, version: "bbbbbbbbbbbb" }),
    );
    assert.isTrue(Option.isNone(stagedCheck(INSTALLED, Option.some(INSTALLED))));
    assert.isTrue(Option.isNone(stagedCheck(INSTALLED, Option.none())));
  });

  it("maps release-desktop.sh exit codes", () => {
    const rows: ReadonlyArray<readonly [number, ReleaseExit]> = [
      [75, { _tag: "Staged" }],
      [0, { _tag: "Installed" }],
      [73, { _tag: "Busy" }],
      [74, { _tag: "WorktreeInUse" }],
      [1, { _tag: "Failed", code: 1 }],
      [143, { _tag: "Failed", code: 143 }],
    ];
    for (const [code, expected] of rows) assert.deepStrictEqual(releaseExitOf(code), expected);
  });

  it("passes the build only allow-listed environment", () => {
    const env = releaseEnvironment(
      {
        HOME: "/Users/toby",
        PATH: "/opt/homebrew/bin:/usr/bin",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        T3CODE_HOME: "/Users/toby/.t3-fork",
        T3CODE_DISABLE_AUTO_UPDATE: "1",
        ELECTRON_RUN_AS_NODE: "1",
        NODE_OPTIONS: "--inspect",
        GITHUB_REPOSITORY: "pingdotgg/t3code",
      },
      "/Users/toby/t3code",
    );
    assert.deepStrictEqual(env, {
      HOME: "/Users/toby",
      PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      T3_FORK_REPO: "/Users/toby/t3code",
      GIT_TERMINAL_PROMPT: "0",
    });
  });

  it("accepts only absolute paths and a full commit in fork-release.json", () => {
    const valid = {
      repo: "/Users/toby/t3code",
      commit: INSTALLED,
      installPath: "/Users/toby/Applications/T3 Code Fork.app",
      releasesDir: "/Users/toby/.t3-fork/releases",
    };
    assert.deepStrictEqual(parseForkRelease(JSON.stringify(valid)), Option.some(valid));
    for (const invalid of [
      { ...valid, repo: "t3code" },
      { ...valid, commit: INSTALLED.slice(0, 12) },
      { ...valid, releasesDir: undefined },
    ]) {
      assert.isTrue(Option.isNone(parseForkRelease(JSON.stringify(invalid))));
    }
  });

  it.live("installs once after the app exits, then relaunches even when the install fails", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const releases = yield* fileSystem.makeTempDirectoryScoped();
      const events = path.join(releases, "events");
      const app = yield* spawner.spawn(ChildProcess.make("sleep", ["1"]));
      const script = path.join(releases, "release-desktop.sh");
      yield* fileSystem.writeFileString(
        script,
        `state=$(kill -0 ${app.pid} 2>/dev/null && echo app-running || echo app-gone)
echo "install $* $state" >>"${events}"
exit 1
`,
      );

      const helper = yield* spawner.spawn(
        ChildProcess.make("/bin/sh", [
          "-c",
          INSTALL_HELPER_SCRIPT,
          "t3-fork-install",
          String(app.pid),
          path.join(releases, "missing.app"),
          releases,
          script,
          "/bin/sh",
          "-c",
          'echo relaunch >>"$1"',
          "relaunch",
          events,
        ]),
      );
      assert.equal(yield* helper.exitCode, 0);

      assert.deepStrictEqual((yield* fileSystem.readFileString(events)).trim().split("\n"), [
        "install --install-staged app-gone",
        "relaunch",
      ]);
      assert.include(
        yield* fileSystem.readFileString(path.join(releases, "install.log")),
        "--install-staged exited 1",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
