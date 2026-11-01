import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const AbsolutePath = Schema.String.check(Schema.isPattern(/^\/./));
const CommitSha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

/** Written by scripts/fork/release-desktop.sh. Only a fork bundle has it. */
export const ForkRelease = Schema.Struct({
  repo: AbsolutePath,
  commit: CommitSha,
  installPath: AbsolutePath,
  releasesDir: AbsolutePath,
});
export type ForkRelease = typeof ForkRelease.Type;

export const FORK_RELEASE_FILE = "fork-release.json";
export const RELEASE_SCRIPT_PATH = "scripts/fork/release-desktop.sh";
export const IN_APP_RELEASE_SCRIPT_FILE = ".in-app-release-desktop.sh";

export const parseForkRelease = Schema.decodeUnknownOption(Schema.fromJsonString(ForkRelease));

export const isCommitSha = Schema.is(CommitSha);

/** availableVersion and downloadedVersion must be equal strings, and a commit is the only name
 *  a build has before it is built. */
export const forkVersionOf = (sha: string): string => sha.slice(0, 12);

export type ForkCheck =
  | { readonly _tag: "UpToDate" }
  | { readonly _tag: "Available"; readonly fullSha: string; readonly version: string }
  | { readonly _tag: "Staged"; readonly fullSha: string; readonly version: string }
  | { readonly _tag: "NotDescendant"; readonly fullSha: string };

/** A staged build that is not this one wins over origin/main: a restart is cheap, a build is not. */
export const stagedCheck = (installed: string, staged: Option.Option<string>) =>
  staged.pipe(
    Option.filter((sha) => sha !== installed),
    Option.map((sha): ForkCheck => ({ _tag: "Staged", fullSha: sha, version: forkVersionOf(sha) })),
  );

/** Only forward moves are offered; a rewound or diverged origin/main is reported, not installed. */
export const targetCheck = (input: {
  readonly installed: string;
  readonly target: string;
  readonly descends: boolean;
}): ForkCheck => {
  if (input.target === input.installed) return { _tag: "UpToDate" };
  return input.descends
    ? { _tag: "Available", fullSha: input.target, version: forkVersionOf(input.target) }
    : { _tag: "NotDescendant", fullSha: input.target };
};

export type ReleaseExit =
  | { readonly _tag: "Staged" }
  | { readonly _tag: "Installed" }
  | { readonly _tag: "Busy" }
  | { readonly _tag: "WorktreeInUse" }
  | { readonly _tag: "Failed"; readonly code: number };

const RELEASE_EXITS: Readonly<Record<number, ReleaseExit>> = {
  75: { _tag: "Staged" },
  0: { _tag: "Installed" },
  73: { _tag: "Busy" },
  74: { _tag: "WorktreeInUse" },
};

export const releaseExitOf = (code: number): ReleaseExit =>
  RELEASE_EXITS[code] ?? { _tag: "Failed", code };

export const releaseFailureDetail = (
  exit: Exclude<ReleaseExit, { readonly _tag: "Staged" }>,
  context: { readonly releasesDir: string; readonly stderrTail: string },
): string => {
  switch (exit._tag) {
    case "Installed":
      return "The release script found nothing to stage. Restart T3 Code Fork to load the installed build.";
    case "Busy":
      return "Another fork release is running. Try again when it finishes.";
    case "WorktreeInUse":
      return "Processes are still working in the fork's release worktree. Let them finish, then try again.";
    case "Failed":
      return [
        `The fork build failed (exit ${exit.code}).`,
        context.stderrTail,
        `See ${context.releasesDir}/build.log.`,
      ]
        .filter((part) => part.length > 0)
        .join(" ");
  }
};

const RELEASE_MILESTONES: ReadonlyArray<readonly [prefix: string, percent: number]> = [
  ["Building ", 10],
  ["Built ", 90],
];

export const releaseLineProgress = (line: string): number | null =>
  RELEASE_MILESTONES.find(([prefix]) => line.startsWith(prefix))?.[1] ?? null;

const INHERITED_RELEASE_ENV = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "PATH",
  "SSH_AUTH_SOCK",
] as const;

const pickEnvironment = (env: NodeJS.ProcessEnv, names: ReadonlyArray<string>) =>
  Object.fromEntries(
    names.flatMap((name) => {
      const value = env[name];
      return value === undefined ? [] : [[name, value] as const];
    }),
  );

/** An allow-list: this app's T3CODE_*, ELECTRON_* and NODE_* settings must not reach the build. */
export const releaseEnvironment = (
  env: NodeJS.ProcessEnv,
  repo: string,
): Record<string, string> => ({
  ...pickEnvironment(env, INHERITED_RELEASE_ENV),
  T3_FORK_REPO: repo,
  GIT_TERMINAL_PROMPT: "0",
});

/** `open` hands its environment to the app, and ELECTRON_RUN_AS_NODE would make it quit. */
export const installHelperEnvironment = (env: NodeJS.ProcessEnv): Record<string, string> => ({
  ...pickEnvironment(env, ["HOME", "USER", "LOGNAME"]),
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
});

/** Args: <name> <pid> <installPath> <releasesDir> <script> <relaunch argv...>. Waits for every
 *  process from the bundle or releases folder (release-desktop.sh refuses to swap while one runs),
 *  retries for up to 10 minutes while another release run holds the lock (73) or a copy still
 *  runs (75), and relaunches even after a failed install so the old app reports it. */
export const INSTALL_HELPER_SCRIPT = `pid=$1 install_path=$2 releases=$3 script=$4
shift 4
exec >>"$releases/install.log" 2>&1
echo "$(date): waiting for process $pid to quit"
n=0
while kill -0 "$pid" 2>/dev/null && [ "$n" -lt 600 ]; do sleep 0.2; n=$((n + 1)); done
deadline=$(($(date +%s) + 600))
while :; do
  n=0
  while ps -axo comm= | grep -qF -e "$install_path/" -e "$releases/" && [ "$n" -lt 600 ]; do
    sleep 0.2
    n=$((n + 1))
  done
  status=0
  /bin/sh "$script" --install-staged || status=$?
  echo "$(date): release-desktop.sh --install-staged exited $status"
  case $status in 73 | 75) ;; *) break ;; esac
  [ "$(date +%s)" -lt "$deadline" ] || break
  sleep 2
done
exec "$@"
`;
