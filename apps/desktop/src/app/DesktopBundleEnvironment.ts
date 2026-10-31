// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

// A repackaged build (such as a fork installed beside the official app) ships its identity in the
// signed bundle, so it keeps its own T3 home and keychain item however it is launched.
// Variables already set win. Imported first by main.ts, before anything reads the environment.
const readBundleEnvironment = (resourcesPath: string): Record<string, unknown> => {
  try {
    return JSON.parse(
      NodeFS.readFileSync(NodePath.join(resourcesPath, "desktop-env.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
};

if (process.resourcesPath) {
  for (const [name, value] of Object.entries(readBundleEnvironment(process.resourcesPath))) {
    if (typeof value === "string" && process.env[name] === undefined) process.env[name] = value;
  }
}
