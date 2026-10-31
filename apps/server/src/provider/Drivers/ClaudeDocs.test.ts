import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ClaudeArtifactId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  claudeDocsArgs,
  collectConnectorCalls,
  createBatchInput,
  interpretCreate,
  interpretEdit,
  interpretRead,
  makeClaudeDocs,
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
const SHORT_DOC = ClaudeArtifactId.make("AbCdEfGhIjKlMnOpQrStUv");
const OTHER_DOC = "99999999-2222-4333-8444-555555555555";
const EDIT_UPDATE_ID = "toolu_0115Y9VwwdcyQ6H91gUsEArH";

const init = (tools?: ReadonlyArray<string>) =>
  JSON.stringify({ type: "system", subtype: "init", ...(tools === undefined ? {} : { tools }) });

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

const update = (id: string, doc: string) =>
  toolUse(id, "mcp__claude_ai_Claude_Docs__update", {
    ref: { object: "node", id: "n1" },
    container: { kind: "project", id: doc },
  });

it.layer(NodeServices.layer)("ClaudeDocs", (it) => {
  describe("claudeDocsArgs", () => {
    const disallowed =
      "Agent,Task,TaskOutput,TaskStop,Bash,BashOutput,KillShell,PowerShell,Read,Glob,Grep,LS,LSP,NotebookRead,ListMcpResourcesTool,ReadMcpResourceTool,CronCreate,CronDelete,CronList,Monitor,ListAgents,SendMessage,SendToProject,SendToProjectContext,RemoteTrigger,ScheduleWakeup,PushNotification,Workflow,DesignSync,EnterWorktree,ExitWorktree,ReportFindings,TodoWrite,AskUserQuestion,ExitPlanMode,EnterPlanMode,SlashCommand";
    it.each([
      ["read", "ToolSearch,mcp__claude_ai_Claude_Docs__read,mcp__claude_ai_Claude_Docs__export"],
      ["create", "ToolSearch,mcp__claude_ai_Claude_Docs__batch"],
      [
        "edit",
        "ToolSearch,mcp__claude_ai_Claude_Docs__guide,mcp__claude_ai_Claude_Docs__read,mcp__claude_ai_Claude_Docs__update",
      ],
    ] as const)("locks the %s run down to its plan", (plan, allowed) => {
      expect(claudeDocsArgs(PLANS[plan])).toEqual([
        "-p",
        "--model",
        expect.any(String),
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--setting-sources",
        "",
        "--disallowedTools",
        disallowed,
        "--allowedTools",
        allowed,
        "--permission-mode",
        "dontAsk",
        "--settings",
        '{"disableAllHooks":true}',
        "--disable-slash-commands",
      ]);
    });
  });

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
      readonly message?: unknown;
    }> = [
      {
        name: "a CLI that loads a tool dontAsk runs",
        source: [init(["ToolSearch", "Write", "CronList"])],
        id: DOC,
        reason: "run_failed",
        message: expect.stringContaining("CronList"),
      },
      {
        name: "a CLI whose init lists no tools",
        source: [init()],
        id: DOC,
        reason: "run_failed",
      },
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
    it.effect.each(failures)("fails for $name", ({ source, id, reason, message }) =>
      Effect.gen(function* () {
        const lines = typeof source === "string" ? yield* fixture(source) : source;
        expect(interpretRead(id, collectConnectorCalls(lines, PLANS.read))).toMatchObject({
          reason,
          ...(message === undefined ? {} : { message }),
        });
      }),
    );
  });

  describe("interpretEdit", () => {
    const denyUpdate = (line: string) =>
      isResultFor(EDIT_UPDATE_ID)(line)
        ? toolResult(
            EDIT_UPDATE_ID,
            '{"verdict":"deny","reason":"guard_mismatch","hint":"that block changed"}\nsupport: req_test',
            true,
          )
        : line;
    const readOther = [
      toolUse("r9", "mcp__claude_ai_Claude_Docs__read", {
        ref: { object: "project", id: OTHER_DOC },
      }),
      toolResult("r9", '{"verdict":"allow","value":{"name":"Other"},"files":[]}'),
    ];
    const cases: ReadonlyArray<
      readonly [
        name: string,
        id: ClaudeArtifactId,
        lines: (edit: ReadonlyArray<string>) => ReadonlyArray<string>,
        expected: object,
      ]
    > = [
      ["an allowed update on this doc", DOC, (edit) => edit, { url: DOC_URL }],
      [
        "a doc asked for by its short link id",
        SHORT_DOC,
        (edit) =>
          edit.map((line) =>
            line.replace(
              `"ref":{"object":"project","id":"${DOC}"}`,
              `"ref":{"object":"project","id":"${SHORT_DOC}"}`,
            ),
          ),
        { url: DOC_URL },
      ],
      [
        "a landed update followed by a denied retry",
        DOC,
        (edit) => [
          ...edit,
          update("t9", DOC),
          toolResult("t9", '{"verdict":"deny","reason":"guard_mismatch"}', true),
        ],
        { url: DOC_URL },
      ],
      [
        "an update with no result",
        DOC,
        (edit) => edit.filter((line) => !isResultFor(EDIT_UPDATE_ID)(line)),
        { reason: "outcome_unknown" },
      ],
      [
        "a landed update followed by one with no result",
        DOC,
        (edit) => [...edit, update("t9", DOC)],
        { reason: "outcome_unknown", url: DOC_URL },
      ],
      [
        "an allowed update on another doc",
        DOC,
        (edit) => [
          ...edit,
          update("t9", OTHER_DOC),
          toolResult("t9", '{"verdict":"allow","rev":1}'),
        ],
        { reason: "altered", url: DOC_URL, message: expect.stringContaining(OTHER_DOC) },
      ],
      [
        "a read of another doc after the edit landed",
        DOC,
        (edit) => [...edit, ...readOther],
        { reason: "altered", url: DOC_URL, message: expect.stringContaining(OTHER_DOC) },
      ],
      [
        "a read of another doc with no edit",
        DOC,
        (edit) => [...edit.map(denyUpdate), ...readOther],
        { reason: "refused", message: expect.stringContaining(OTHER_DOC) },
      ],
      [
        "a Docs tool outside the plan after the edit landed",
        DOC,
        (edit) => [
          ...edit,
          toolUse("t9", "mcp__claude_ai_Claude_Docs__delete", {
            ref: { object: "project", id: DOC },
          }),
        ],
        { reason: "altered", url: DOC_URL, message: expect.stringContaining("delete") },
      ],
      [
        "a denied update",
        DOC,
        (edit) => edit.map(denyUpdate),
        {
          reason: "refused",
          message: "claude.ai refused the call (guard_mismatch): that block changed",
        },
      ],
    ];
    it.effect.each(cases)("reports %s", ([, id, lines, expected]) =>
      fixture("edit").pipe(
        Effect.map((edit) => {
          expect(interpretEdit(id, collectConnectorCalls(lines(edit), PLANS.edit))).toMatchObject(
            expected,
          );
        }),
      ),
    );
  });

  describe("interpretCreate", () => {
    const sent = createBatchInput("Q3 plan", "# Q3 plan\n\nShip it.");
    const batch = "mcp__claude_ai_Claude_Docs__batch";
    const OTHER_URL = "https://claude.ai/artifact/ZyXwVuTsRqPoNmLkJiHgFe";
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
          toolResult("b2", `{"verdict":"allow","created":{"bound":true}}\nOpen it: ${OTHER_URL}`),
        ],
        { reason: "altered", url: DOC_URL, message: expect.stringContaining(OTHER_URL) },
      ],
      ["a lost result", [toolUse("b1", batch, sent)], { reason: "outcome_unknown" }],
      [
        "a birth and a lost result",
        [toolUse("b1", batch, sent), toolResult("b1", ack), toolUse("b2", batch, sent)],
        { reason: "outcome_unknown", url: DOC_URL },
      ],
      [
        "a birth and a tool outside the plan",
        [toolUse("b1", batch, sent), toolResult("b1", ack), toolUse("w1", "WebFetch", {})],
        { reason: "altered", url: DOC_URL, message: expect.stringContaining("WebFetch") },
      ],
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

describe("makeClaudeDocs", () => {
  // A stub CLI: the run must stop it, not wait out the plan's timeout.
  const runs: ReadonlyArray<{
    readonly name: string;
    readonly script: (transcript: string) => string;
    readonly call: "read" | "edit";
    readonly expected: object;
  }> = [
    {
      name: "kills a CLI that loads a tool dontAsk runs",
      script: () => `printf '%s\\n' '${init(["ToolSearch", "CronList"])}'\nexec sleep 30`,
      call: "read",
      expected: { reason: "run_failed", message: expect.stringContaining("CronList") },
    },
    {
      name: "kills a CLI that floods stderr",
      script: () => "exec yes >&2",
      call: "read",
      expected: { reason: "run_failed", message: expect.stringContaining("too large") },
    },
    {
      name: "keeps a landed edit unknown when the stream was cut off",
      script: (transcript) => `cat '${transcript}'\nexit 1`,
      call: "edit",
      expected: { reason: "outcome_unknown", url: DOC_URL },
    },
  ];
  it.live.each(runs)("$name", ({ script, call, expected }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fileSystem.makeTempDirectoryScoped();
      const transcript = path.join(dir, "transcript.ndjson");
      const edit = yield* fixture("edit");
      yield* fileSystem.writeFileString(
        transcript,
        edit.filter((line) => !line.includes('"type":"result"')).join("\n"),
      );
      const binaryPath = path.join(dir, "claude");
      yield* fileSystem.writeFileString(binaryPath, `#!/bin/sh\n${script(transcript)}\n`);
      yield* fileSystem.chmod(binaryPath, 0o755);
      const docs = yield* makeClaudeDocs(
        { binaryPath, homePath: "" },
        { PATH: process.env.PATH },
        dir,
      );
      const error = yield* Effect.flip(
        call === "read"
          ? docs.read(DOC)
          : docs.write({ kind: "edit", artifact: DOC, instruction: "Add a line." }),
      );
      expect(error).toMatchObject(expected);
      expect(yield* fileSystem.readDirectory(path.join(dir, "claude-docs"))).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
