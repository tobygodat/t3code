// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { DesktopAppStageLabelSchema } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

// A repackaged build (such as a fork installed beside the official app) ships its identity in the
// signed bundle. Its values replace inherited ones, so the build keeps its own T3 home and keychain
// item however it is launched. Imported first by main.ts, before anything reads the environment.
// Each name is required: a missing or bad value would fall back to the official app's home.
const BUNDLE_ENVIRONMENT: Record<string, (value: string) => boolean> = {
  T3CODE_HOME: NodePath.isAbsolute,
  T3CODE_DISABLE_AUTO_UPDATE: () => true,
  T3CODE_DESKTOP_STAGE_LABEL: Schema.is(DesktopAppStageLabelSchema),
};

export const applyBundleEnvironment = (input: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly env: NodeJS.ProcessEnv;
}): void => {
  if (!input.isPackaged) return;
  let text: string;
  try {
    text = NodeFS.readFileSync(NodePath.join(input.resourcesPath, "desktop-env.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const values: unknown = JSON.parse(text);
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new Error("desktop-env.json does not hold a JSON object.");
  }
  const bundleEnvironment: Record<string, string> = {};
  for (const [name, isValid] of Object.entries(BUNDLE_ENVIRONMENT)) {
    const value = (values as Record<string, unknown>)[name];
    if (typeof value !== "string" || value.length === 0 || !isValid(value)) {
      throw new Error(`desktop-env.json has no valid ${name}: ${JSON.stringify(value)}.`);
    }
    bundleEnvironment[name] = value;
  }
  Object.assign(input.env, bundleEnvironment);
};

try {
  applyBundleEnvironment({
    isPackaged: Electron.app.isPackaged,
    resourcesPath: process.resourcesPath,
    env: process.env,
  });
} catch (error) {
  // Starting anyway would run this build with the official app's T3 home and keychain item.
  const message = `This app's desktop-env.json is unreadable or invalid, so it will not start. ${String(error)}`;
  process.stderr.write(`${message}\n`);
  Electron.dialog.showErrorBox(`${Electron.app.getName()} cannot start`, message);
  process.exit(1);
}
