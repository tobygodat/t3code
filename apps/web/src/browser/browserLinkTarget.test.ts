import type { BrowserLinkTarget } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { resolveLinkTarget } from "./browserLinkTarget";

const settings = vi.hoisted(() => ({ browserLinkTarget: "system" as BrowserLinkTarget }));

vi.mock("~/hooks/useSettings", () => ({
  ensureClientSettingsHydrated: vi.fn(async () => undefined),
  getClientSettings: () => settings,
}));

const click = { metaKey: false, ctrlKey: false };
const ARTIFACT = "https://claude.ai/artifact/q3-plan-AbCdEfGhIjKlMnOpQrStUv";

describe("resolveLinkTarget", () => {
  it("leaves non-web schemes to the shell", () => {
    for (const url of ["mailto:someone@example.com", "vscode://file/x", "not a url"]) {
      expect(
        resolveLinkTarget({
          url,
          event: click,
          preference: "app",
          canOpenInApp: true,
          claudeArtifacts: false,
        }),
      ).toBe("system");
    }
  });

  it.each([
    ["an artifact link while on", ARTIFACT, click, true, true, "app"],
    ["an artifact link while off", ARTIFACT, click, false, true, "system"],
    ["a modifier click", ARTIFACT, { ...click, metaKey: true }, true, true, "system"],
    ["a middle click", ARTIFACT, { ...click, button: 1 }, true, true, "system"],
    ["a thread that cannot open the panel", ARTIFACT, click, true, false, "system"],
    ["another claude.ai page", "https://claude.ai/login", click, true, true, "system"],
    [
      "a look-alike host",
      "https://claude.ai.evil.example/artifact/AbCdEfGhIjKlMnOpQrStUv",
      click,
      true,
      true,
      "system",
    ],
  ])(
    "beats a system-browser preference only for %s",
    (_name, url, event, claudeArtifacts, canOpenInApp, expected) => {
      expect(
        resolveLinkTarget({ url, event, preference: "system", canOpenInApp, claudeArtifacts }),
      ).toBe(expected);
    },
  );
});
