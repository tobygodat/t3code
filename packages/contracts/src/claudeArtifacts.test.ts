import { describe, expect, it } from "@effect/vitest";

import {
  parseClaudeArtifactRef,
  parseClaudeArtifactUrl,
  pickClaudeDocsInstance,
} from "./claudeArtifacts.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import type { ServerProviderAuth } from "./server.ts";

const DOC_UUID = "37fde499-203e-449a-8770-fce0c9a5ad48";
const DOC_SHORT = "7v23M2b7X19h9f8ceaMniT";

describe("parseClaudeArtifactUrl", () => {
  it.each([
    [`https://claude.ai/artifact/${DOC_SHORT}`, DOC_SHORT],
    [`https://claude.ai/artifact/${DOC_UUID}`, DOC_UUID],
    [`https://claude.ai/artifact/q3-launch-plan-${DOC_UUID}`, DOC_UUID],
    [`https://claude.ai/artifact/q3-plan-${DOC_SHORT}#f-45bd489e-6998`, DOC_SHORT],
    [`https://claude.ai/code/artifact/${DOC_SHORT}/`, DOC_SHORT],
    [`https://claude.ai/artifact/${DOC_SHORT}?tab=1`, DOC_SHORT],
    ["https://claude.ai/login", null],
    ["https://claude.ai/chat/0a5ce2a1-cc28-4666-993e-2a320db11f56", null],
    [`https://claude.ai/artifact/${DOC_SHORT}/edit`, null],
    [`http://claude.ai/artifact/${DOC_SHORT}`, null],
    [`https://claude.ai.evil.example/artifact/${DOC_SHORT}`, null],
    [`https://evil.example/claude.ai/artifact/${DOC_SHORT}`, null],
    [`https://www.claude.ai/artifact/${DOC_SHORT}`, null],
    ["not a url", null],
  ])("%s → %s", (url, id) => {
    expect(parseClaudeArtifactUrl(url)).toBe(id);
  });

  it("accepts a bare doc id as a ref but not as a link", () => {
    expect(parseClaudeArtifactRef(` ${DOC_UUID} `)).toBe(DOC_UUID);
    expect(parseClaudeArtifactUrl(DOC_UUID)).toBeNull();
    expect(parseClaudeArtifactRef("too-short")).toBeNull();
  });
});

describe("pickClaudeDocsInstance", () => {
  const claude = (
    instanceId: string,
    auth: ServerProviderAuth,
    overrides: { readonly enabled?: boolean; readonly driver?: string } = {},
  ) => ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(overrides.driver ?? "claudeAgent"),
    enabled: overrides.enabled ?? true,
    auth,
  });
  const subscription: ServerProviderAuth = { status: "authenticated", type: "claude_max" };

  it.each([
    ["subscription login", [claude("claudeAgent", subscription)], "claudeAgent"],
    [
      "API key login",
      [claude("claudeAgent", { status: "authenticated", type: "apiKey" })],
      undefined,
    ],
    ["Bedrock", [claude("claudeAgent", { status: "authenticated", type: "bedrock" })], undefined],
    [
      "custom endpoint",
      [claude("claudeAgent", { status: "authenticated", type: "customEndpoint" })],
      undefined,
    ],
    ["no auth type", [claude("claudeAgent", { status: "authenticated" })], undefined],
    [
      "signed out",
      [claude("claudeAgent", { status: "unauthenticated", type: "claude_max" })],
      undefined,
    ],
    ["disabled", [claude("claudeAgent", subscription, { enabled: false })], undefined],
    ["another driver", [claude("codex", subscription, { driver: "codex" })], undefined],
    [
      "default instance first",
      [claude("claude-work", subscription), claude("claudeAgent", subscription)],
      "claudeAgent",
    ],
    [
      "lowest id without a default",
      [claude("claude-zeta", subscription), claude("claude-alpha", subscription)],
      "claude-alpha",
    ],
    [
      "skips an ineligible default",
      [
        claude("claudeAgent", { status: "authenticated", type: "apiKey" }),
        claude("claude-work", subscription),
      ],
      "claude-work",
    ],
  ])("%s", (_name, providers, expected) => {
    expect(pickClaudeDocsInstance(providers)).toBe(expected);
  });
});
