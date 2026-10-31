import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { defaultInstanceIdForDriver, ProviderDriverKind } from "./providerInstance.ts";
import type { ProviderInstanceId } from "./providerInstance.ts";
import type { ServerProvider } from "./server.ts";

export const ClaudeArtifactId = Schema.String.pipe(Schema.brand("ClaudeArtifactId"));
export type ClaudeArtifactId = typeof ClaudeArtifactId.Type;

const ARTIFACT_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9]{22}";
const BARE_ARTIFACT_ID = new RegExp(`^(?:${ARTIFACT_ID})$`, "i");
// The `<title>-` prefix may itself contain hyphens, so the id is anchored at the end.
const ARTIFACT_PATH = new RegExp(`^/(?:code/)?artifact/(?:[^/]*-)?(${ARTIFACT_ID})/?$`, "i");

/** The doc id in `https://claude.ai/[code/]artifact/[<title>-]<id>`, or null for any other URL. */
export function parseClaudeArtifactUrl(url: string): ClaudeArtifactId | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "claude.ai") return null;
  const id = ARTIFACT_PATH.exec(parsed.pathname)?.[1];
  return id === undefined ? null : ClaudeArtifactId.make(id);
}

/** A claude.ai artifact link or a bare doc id. */
export function parseClaudeArtifactRef(input: string): ClaudeArtifactId | null {
  const trimmed = input.trim();
  return BARE_ARTIFACT_ID.test(trimmed)
    ? ClaudeArtifactId.make(trimmed)
    : parseClaudeArtifactUrl(trimmed);
}

const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const NON_SUBSCRIPTION_AUTH_TYPES: ReadonlySet<string> = new Set([
  "apiKey",
  "bedrock",
  "customEndpoint",
]);

/**
 * The Claude instance whose CLI login carries claude.ai connectors: enabled, signed in with a
 * claude.ai subscription. The default instance wins, then the lowest id.
 */
export function pickClaudeDocsInstance(
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver" | "enabled" | "auth">>,
): ProviderInstanceId | undefined {
  const candidates = providers
    .filter(
      (provider) =>
        provider.driver === CLAUDE_DRIVER_KIND &&
        provider.enabled &&
        provider.auth.status === "authenticated" &&
        provider.auth.type !== undefined &&
        !NON_SUBSCRIPTION_AUTH_TYPES.has(provider.auth.type),
    )
    .map((provider) => provider.instanceId);
  const preferred = defaultInstanceIdForDriver(CLAUDE_DRIVER_KIND);
  return candidates.includes(preferred) ? preferred : [...candidates].sort()[0];
}

const CLAUDE_ARTIFACT_MAX_MARKDOWN_CHARS = 100_000;

const ClaudeArtifactRefInput = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)).annotate({
  description: "The doc's claude.ai link or id.",
});

export const ClaudeArtifactReadInput = Schema.Struct({ artifact: ClaudeArtifactRefInput });
export type ClaudeArtifactReadInput = typeof ClaudeArtifactReadInput.Type;

export const ClaudeArtifactTab = Schema.Struct({ name: Schema.String, markdown: Schema.String });
export type ClaudeArtifactTab = typeof ClaudeArtifactTab.Type;

export const ClaudeArtifactReadResult = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  tabs: Schema.Array(ClaudeArtifactTab),
  truncated: Schema.Boolean,
});
export type ClaudeArtifactReadResult = typeof ClaudeArtifactReadResult.Type;

export const ClaudeArtifactWriteInput = Schema.Struct({
  markdown: Schema.optional(
    Schema.String.check(Schema.isMaxLength(CLAUDE_ARTIFACT_MAX_MARKDOWN_CHARS)).annotate({
      description: "Create: the new doc's markdown. Its first # heading is the title.",
    }),
  ),
  artifact: Schema.optional(ClaudeArtifactRefInput),
  instruction: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(4_000)).annotate({
      description: "Edit: the change to make, quoting the exact text to change.",
    }),
  ),
});
export type ClaudeArtifactWriteInput = typeof ClaudeArtifactWriteInput.Type;

export const ClaudeArtifactWriteResult = Schema.Struct({ url: Schema.String });
export type ClaudeArtifactWriteResult = typeof ClaudeArtifactWriteResult.Type;

export type ClaudeArtifactWrite =
  | { readonly kind: "create"; readonly title: string; readonly markdown: string }
  | {
      readonly kind: "edit";
      readonly artifact: ClaudeArtifactId;
      readonly instruction: string;
    };

export const ClaudeArtifactsErrorReason = Schema.Literals([
  "disabled",
  "no_claude_login",
  "connector_missing",
  "not_a_doc",
  "refused",
  "altered",
  "nothing_changed",
  "outcome_unknown",
  "run_failed",
]);
export type ClaudeArtifactsErrorReason = typeof ClaudeArtifactsErrorReason.Type;

export class ClaudeArtifactsError extends Schema.TaggedError<ClaudeArtifactsError>()(
  "ClaudeArtifactsError",
  {
    reason: ClaudeArtifactsErrorReason,
    message: Schema.String,
    url: Schema.optional(Schema.String),
  },
) {}
