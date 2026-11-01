import { describe, expect, it } from "vite-plus/test";
import type { DesktopUpdateState } from "@t3tools/contracts";

import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateIdleTooltip,
  getDesktopUpdateReleaseHistoryUrl,
  getDesktopUpdateReleaseUrl,
  resolveDesktopUpdateButtonAction,
} from "./desktopUpdate.logic";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

describe("desktop update button state", () => {
  it("keeps retry action available after a download error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      availableVersion: "1.1.0",
      message: "network timeout",
      errorContext: "download",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to retry");
  });

  it("prefers a newly available release over a stale downloaded version", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.2.0",
      downloadedVersion: "1.1.0",
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
  });

  it("hides the install action while checking for a newer release", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "checking",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      downloadPercent: 100,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("none");
  });
});

describe("desktop update UI helpers", () => {
  it.each(["owner/repo/extra", "owner#notes/repo", "owner/repo?tab=notes"])(
    "falls back to upstream for an invalid configured repository: %s",
    (repository) => {
      expect(getDesktopUpdateReleaseHistoryUrl(repository)).toBe(
        "https://github.com/pingdotgg/t3code/releases",
      );
      expect(getDesktopUpdateReleaseUrl("1.2.3", repository)).toBe(
        "https://github.com/pingdotgg/t3code/releases/tag/v1.2.3",
      );
    },
  );

  it("has no release page for a version that is not a release, such as a fork commit", () => {
    expect(getDesktopUpdateReleaseUrl("4e49a601ec12")).toBeNull();
  });
});

describe("getDesktopUpdateIdleTooltip", () => {
  const failed = "origin/main does not contain this build's commit.";
  it.each<[string, Partial<DesktopUpdateState>, ReturnType<typeof getDesktopUpdateIdleTooltip>]>([
    ["nothing happened yet", {}, { title: "Check for updates", detail: null }],
    [
      "a failed check",
      { status: "error", errorContext: "check", message: failed },
      { title: "Update check failed", detail: failed },
    ],
    [
      "an updater error with nothing downloaded",
      { status: "error", errorContext: null, message: failed },
      { title: "Update check failed", detail: failed },
    ],
    [
      "a failed download",
      { status: "error", errorContext: "download", message: failed },
      { title: "Check for updates", detail: null },
    ],
    [
      "disabled updates",
      { enabled: false, status: "disabled", message: "No update feed." },
      { title: "Updates unavailable", detail: "No update feed." },
    ],
  ])("shows %s", (_name, overrides, expected) => {
    expect(getDesktopUpdateIdleTooltip({ ...baseState, ...overrides })).toEqual(expected);
  });
});

describe("canCheckForUpdate", () => {
  it("returns true once an update has been downloaded so newer releases can be found", () => {
    expect(
      canCheckForUpdate({
        ...baseState,
        status: "downloaded",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
      }),
    ).toBe(true);
  });
});
