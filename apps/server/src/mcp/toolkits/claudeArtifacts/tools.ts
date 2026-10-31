import {
  ClaudeArtifactReadInput,
  ClaudeArtifactReadResult,
  ClaudeArtifactWriteInput,
  ClaudeArtifactWriteResult,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ClaudeArtifacts from "../../../provider/ClaudeArtifacts.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [McpInvocationContext.McpInvocationContext, ClaudeArtifacts.ClaudeArtifacts],
};

// Two tools because one cannot carry a truthful Readonly annotation for both reads and writes.
const ClaudeArtifactReadTool = Tool.make("claude_artifact_read", {
  ...shared,
  description: "Read a claude.ai doc as markdown, one entry per tab.",
  parameters: ClaudeArtifactReadInput,
  success: ClaudeArtifactReadResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.offeredClaudeArtifacts);

const ClaudeArtifactWriteTool = Tool.make("claude_artifact_write", {
  ...shared,
  dependencies: [...shared.dependencies, ThreadManagementService.ThreadManagementService],
  description:
    "Create a claude.ai doc from markdown, or edit one: pass artifact and an instruction quoting the exact text to change. Put the returned link in your reply. If the outcome is unknown, read the doc before retrying.",
  parameters: ClaudeArtifactWriteInput,
  success: ClaudeArtifactWriteResult,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.offeredClaudeArtifacts);

export const ClaudeArtifactsToolkit = Toolkit.make(ClaudeArtifactReadTool, ClaudeArtifactWriteTool);
