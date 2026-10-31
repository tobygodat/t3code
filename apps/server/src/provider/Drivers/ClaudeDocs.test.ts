import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ClaudeArtifactId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  collectConnectorCalls,
  createBatchInput,
  interpretCreate,
  interpretEdit,
  interpretRead,
  PLANS,
} from "./ClaudeDocs.ts";

// Sanitized stream-json from real `claude -p` runs against a test doc.
const fixture = Effect.fn("fixture")(function* (name: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = yield* path.fromFileUrl(
    new URL(`./testing/claudeDocs-${name}.ndjson`, import.meta.url),
  );
  return (yield* fileSystem.readFileString(file)).split("\n");
});

const DOC = ClaudeArtifactId.make("11111111-2222-4333-8444-555555555555");
const DOC_URL = "https://claude.ai/artifact/AbCdEfGhIjKlMnOpQrStUv";
const EDIT_UPDATE_ID = "toolu_0115Y9VwwdcyQ6H91gUsEArH";

const toolUse = (id: string, name: string, input: unknown) =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
const toolResult = (id: string, text: string, isError = false) =>
  JSON.stringify({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: [{ type: "text", text }],
          is_error: isError,
        },
      ],
    },
  });
const prose = (text: string) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });
const isResultFor = (id: string) => (line: string) =>
  line.includes('"type":"user"') && line.includes(id);

it.layer(NodeServices.layer)("ClaudeDocs", (it) => {
  describe("interpretRead", () => {
    it.effect("returns every tab's markdown from the connector, not the model's prose", () =>
      Effect.gen(function* () {
        const result = interpretRead(
          DOC,
          collectConnectorCalls(yield* fixture("read"), PLANS.read),
        );

        expect(result).toEqual({
          url: DOC_URL,
          title: "TOB-271 spike test (safe to delete)",
          tabs: [
            {
              name: "TOB-271 spike test (safe to delete)",
              markdown: expect.stringMatching(
                /^# TOB-271 spike test\n[\s\S]*Only the claude CLI ever holds the login\.\n$/,
              ),
            },
          ],
          truncated: false,
        });
      }),
    );

    const failures: ReadonlyArray<{
      readonly name: string;
      readonly source: string | ReadonlyArray<string>;
      readonly id: ClaudeArtifactId;
      readonly reason: string;
    }> = [
      {
        name: "a doc this account cannot see",
        source: "read-denied",
        id: ClaudeArtifactId.make("00000000-0000-4000-8000-000000000000"),
        reason: "not_a_doc",
      },
      {
        name: "a run that called other tools",
        source: "stray-tools",
        id: DOC,
        reason: "run_failed",
      },
      {
        name: "a run that never reached the connector",
        source: [
          toolUse("t1", "ToolSearch", { query: "select:x" }),
          toolResult("t1", "No matches"),
          prose(`Done: ${DOC_URL}`),
        ],
        id: DOC,
        reason: "connector_missing",
      },
      {
        name: "a read of another doc",
        source: "read",
        id: ClaudeArtifactId.make("99999999-2222-4333-8444-555555555555"),
        reason: "run_failed",
      },
    ];
    it.effect.each(failures)("fails for $name", ({ source, id, reason }) =>
      Effect.gen(function* () {
        const lines = typeof source === "string" ? yield* fixture(source) : source;
        expect(interpretRead(id, collectConnectorCalls(lines, PLANS.read))).toMatchObject({
          reason,
        });
      }),
    );
  });

  describe("interpretEdit", () => {
    const editCase = (name: string, body: (edit: ReadonlyArray<string>) => void) =>
      it.effect(name, () => fixture("edit").pipe(Effect.map(body)));

    editCase("succeeds when the last update on this doc is allowed", (edit) => {
      expect(interpretEdit(DOC, collectConnectorCalls(edit, PLANS.edit))).toEqual({ url: DOC_URL });
    });

    editCase("reports an update with no result as an unknown outcome", (edit) => {
      const lines = edit.filter((line) => !isResultFor(EDIT_UPDATE_ID)(line));
      expect(interpretEdit(DOC, collectConnectorCalls(lines, PLANS.edit))).toMatchObject({
        reason: "outcome_unknown",
      });
    });

    editCase("refuses when an update targets another doc, even if it landed", (edit) => {
      const other = "99999999-2222-4333-8444-555555555555";
      const lines = [
        ...edit,
        toolUse("t9", "mcp__claude_ai_Claude_Docs__update", {
          ref: { object: "node", id: "n1" },
          container: { kind: "project", id: other },
        }),
        toolResult("t9", '{"verdict":"allow","rev":1}'),
      ];
      expect(interpretEdit(DOC, collectConnectorCalls(lines, PLANS.edit))).toMatchObject({
        reason: "refused",
        message: expect.stringContaining(other),
      });
    });

    editCase("treats a Docs tool outside the edit plan as a stray call", (edit) => {
      const lines = [
        ...edit,
        toolUse("t9", "mcp__claude_ai_Claude_Docs__delete", {
          ref: { object: "project", id: DOC },
        }),
      ];
      expect(interpretEdit(DOC, collectConnectorCalls(lines, PLANS.edit))).toMatchObject({
        reason: "run_failed",
      });
    });

    editCase("reports a denied update with the connector's reason", (edit) => {
      const lines = edit.map((line) =>
        isResultFor(EDIT_UPDATE_ID)(line)
          ? toolResult(
              EDIT_UPDATE_ID,
              '{"verdict":"deny","reason":"guard_mismatch","hint":"that block changed"}\nsupport: req_test',
              true,
            )
          : line,
      );
      expect(interpretEdit(DOC, collectConnectorCalls(lines, PLANS.edit))).toMatchObject({
        reason: "refused",
        message: "claude.ai refused the call (guard_mismatch): that block changed",
      });
    });
  });

  describe("interpretCreate", () => {
    const sent = createBatchInput("Q3 plan", "# Q3 plan\n\nShip it.");
    const batch = "mcp__claude_ai_Claude_Docs__batch";
    // Birth acks are documented by the connector guide; no live create was captured.
    const ack = JSON.stringify({
      verdict: "allow",
      created: { bound: true },
      lids: { f: "aaaa1111-bbbb", n: "cccc2222-dddd" },
      frame: { slug: DOC, url: DOC_URL },
    });

    it.each([
      ["the exact input", [toolUse("b1", batch, sent), toolResult("b1", ack)], { url: DOC_URL }],
      [
        "a link in the ack's trailer",
        [
          toolUse("b1", batch, sent),
          toolResult("b1", `{"verdict":"allow","created":{"bound":true}}\nOpen it: ${DOC_URL}`),
        ],
        { url: DOC_URL },
      ],
      [
        "altered markdown",
        [
          toolUse("b1", batch, createBatchInput("Q3 plan", "# Q3 plan\n\nShip it soon.")),
          toolResult("b1", ack),
        ],
        { reason: "altered", url: DOC_URL },
      ],
      [
        "two births",
        [
          toolUse("b1", batch, sent),
          toolResult("b1", ack),
          toolUse("b2", batch, sent),
          toolResult("b2", ack),
        ],
        { reason: "altered", url: DOC_URL },
      ],
      ["a lost result", [toolUse("b1", batch, sent)], { reason: "outcome_unknown" }],
      [
        "a refusal",
        [
          toolUse("b1", batch, sent),
          toolResult(
            "b1",
            '{"verdict":"deny","reason":"bad_request","detail":"container:required"}',
            true,
          ),
        ],
        {
          reason: "refused",
          message: "claude.ai refused the call (bad_request): container:required",
        },
      ],
      ["no batch call", [prose("I could not find the tool.")], { reason: "connector_missing" }],
    ])("%s", (_name, lines, expected) => {
      expect(interpretCreate(sent, collectConnectorCalls(lines, PLANS.create))).toMatchObject(
        expected,
      );
    });
  });
});
