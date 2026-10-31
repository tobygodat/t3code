import {
  type ClaudeArtifactsError,
  type ClaudeArtifactWrite,
  type ClaudeArtifactWriteInput,
  OrchestratorMcpFailure,
  parseClaudeArtifactRef,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ClaudeArtifacts from "../../../provider/ClaudeArtifacts.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ClaudeArtifactsToolkit } from "./tools.ts";

const MAX_TITLE_CHARS = 80;
const isFailure = Schema.is(OrchestratorMcpFailure);

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const FAILURE_CODES = {
  disabled: "capability_denied",
  no_claude_login: "provider_unavailable",
  connector_missing: "provider_unavailable",
  not_a_doc: "invalid_request",
  refused: "invalid_request",
  altered: "orchestration_error",
  nothing_changed: "orchestration_error",
  outcome_unknown: "orchestration_error",
  run_failed: "orchestration_error",
} as const satisfies Record<ClaudeArtifactsError["reason"], OrchestratorMcpFailure["code"]>;

const toFailure = (error: ClaudeArtifactsError) =>
  new OrchestratorMcpFailure({
    code: FAILURE_CODES[error.reason],
    message: error.url === undefined ? error.message : `${error.message} Doc: ${error.url}`,
  });

const titleOf = (markdown: string) => {
  const lines = markdown.split("\n").map((line) => line.trim());
  const title =
    lines.find((line) => line.startsWith("# "))?.slice(2) ?? lines.find((line) => line !== "");
  return (title ?? "Untitled").slice(0, MAX_TITLE_CHARS);
};

/** Exactly one of create (markdown) or edit (artifact + instruction). */
function parseWrite(input: ClaudeArtifactWriteInput): ClaudeArtifactWrite | OrchestratorMcpFailure {
  const { markdown, artifact, instruction } = input;
  if (markdown !== undefined && artifact === undefined && instruction === undefined) {
    return markdown.trim() === ""
      ? invalid("markdown is empty.")
      : { kind: "create", title: titleOf(markdown), markdown };
  }
  if (markdown === undefined && artifact !== undefined && instruction !== undefined) {
    const id = parseClaudeArtifactRef(artifact);
    return id === null
      ? invalid("artifact must be a claude.ai/artifact link or a doc id.")
      : { kind: "edit", artifact: id, instruction };
  }
  return invalid("Pass markdown to create a doc, or artifact and instruction to edit one.");
}

export const layer = McpToolAccess.toLayer(ClaudeArtifactsToolkit, {
  claude_artifact_read: McpToolAccess.readsAsCaller(({ artifact }) =>
    Effect.gen(function* () {
      const id = parseClaudeArtifactRef(artifact);
      if (id === null)
        return yield* invalid("artifact must be a claude.ai/artifact link or a doc id.");
      const service = yield* ClaudeArtifacts.ClaudeArtifacts;
      return yield* service.read(id).pipe(Effect.mapError(toFailure));
    }),
  ),
  claude_artifact_write: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const request = parseWrite(input);
      if (isFailure(request)) return yield* request;
      const service = yield* ClaudeArtifacts.ClaudeArtifacts;
      return yield* service.write(request).pipe(Effect.mapError(toFailure));
    }),
  ),
});
