// @effect-diagnostics nodeBuiltinImport:off -- Bundle fixtures live in a temp directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { applyBundleEnvironment } from "./DesktopBundleEnvironment.ts";

let resourcesPath: string;
beforeEach(() => {
  resourcesPath = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-bundle-env-"));
});
afterEach(() => {
  NodeFS.rmSync(resourcesPath, { recursive: true, force: true });
});

const writeBundleEnvironment = (text: string) =>
  NodeFS.writeFileSync(NodePath.join(resourcesPath, "desktop-env.json"), text);

const forkEnvironment = JSON.stringify({
  T3CODE_HOME: "/Users/me/.t3-fork",
  T3CODE_DISABLE_AUTO_UPDATE: "1",
  T3CODE_DESKTOP_STAGE_LABEL: "Fork",
});

it("replaces inherited values, including empty and unknown ones", () => {
  writeBundleEnvironment(forkEnvironment);
  const env = { T3CODE_HOME: "", T3CODE_DESKTOP_STAGE_LABEL: "", T3CODE_DISABLE_AUTO_UPDATE: "0" };
  applyBundleEnvironment({ isPackaged: true, resourcesPath, env });
  expect(env).toEqual({
    T3CODE_HOME: "/Users/me/.t3-fork",
    T3CODE_DISABLE_AUTO_UPDATE: "1",
    T3CODE_DESKTOP_STAGE_LABEL: "Fork",
  });
});

it("applies only the allow-listed names", () => {
  writeBundleEnvironment(
    JSON.stringify({ ...JSON.parse(forkEnvironment), ELECTRON_RUN_AS_NODE: "1", T3CODE_PORT: "1" }),
  );
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
  applyBundleEnvironment({ isPackaged: true, resourcesPath, env });
  expect(env).toEqual({ PATH: "/usr/bin", ...JSON.parse(forkEnvironment) });
});

it.each([
  ["a missing T3CODE_HOME", { T3CODE_HOME: undefined }],
  ["an empty T3CODE_HOME", { T3CODE_HOME: "" }],
  ["a relative T3CODE_HOME", { T3CODE_HOME: ".t3-fork" }],
  ["a numeric T3CODE_HOME", { T3CODE_HOME: 1 }],
  ["a missing T3CODE_DISABLE_AUTO_UPDATE", { T3CODE_DISABLE_AUTO_UPDATE: undefined }],
  ["an empty T3CODE_DISABLE_AUTO_UPDATE", { T3CODE_DISABLE_AUTO_UPDATE: "" }],
  ["a boolean T3CODE_DISABLE_AUTO_UPDATE", { T3CODE_DISABLE_AUTO_UPDATE: true }],
  ["a missing T3CODE_DESKTOP_STAGE_LABEL", { T3CODE_DESKTOP_STAGE_LABEL: undefined }],
  ["a null T3CODE_DESKTOP_STAGE_LABEL", { T3CODE_DESKTOP_STAGE_LABEL: null }],
  ["an unknown T3CODE_DESKTOP_STAGE_LABEL", { T3CODE_DESKTOP_STAGE_LABEL: "Spoon" }],
])("throws and changes nothing on %s", (_, override) => {
  writeBundleEnvironment(JSON.stringify({ ...JSON.parse(forkEnvironment), ...override }));
  const env: NodeJS.ProcessEnv = { T3CODE_HOME: "/inherited" };
  expect(() => applyBundleEnvironment({ isPackaged: true, resourcesPath, env })).toThrow();
  expect(env).toEqual({ T3CODE_HOME: "/inherited" });
});

it("leaves the environment alone when the bundle has no file", () => {
  const env: NodeJS.ProcessEnv = { T3CODE_HOME: "/inherited" };
  applyBundleEnvironment({ isPackaged: true, resourcesPath, env });
  expect(env).toEqual({ T3CODE_HOME: "/inherited" });
});

it("ignores the file when the app is not packaged", () => {
  writeBundleEnvironment(forkEnvironment);
  const env: NodeJS.ProcessEnv = {};
  applyBundleEnvironment({ isPackaged: false, resourcesPath, env });
  expect(env).toEqual({});
});

it.each(["{ not json", "[]", "null", '"Fork"'])("throws on a file holding %s", (text) => {
  writeBundleEnvironment(text);
  const env: NodeJS.ProcessEnv = {};
  expect(() => applyBundleEnvironment({ isPackaged: true, resourcesPath, env })).toThrow();
  expect(env).toEqual({});
});
