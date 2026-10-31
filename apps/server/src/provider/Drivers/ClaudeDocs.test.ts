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

// Sanitized stream-json from real `claude -p` runs against a test doc: ids, paths and account
// fields are replaced, and the init line comes from a 2.1.314 run with claudeDocsArgs. Lines built
// below are synthetic.
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
const READ_EXPORT_ID = "toolu_01EHLJ8jHgXcxDb3ypkDrKKd";

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

const LOCKED = init(["ToolSearch", "Write"]);
const RESULT = JSON.stringify({ type: "result", is_error: false, result: "Done." });
const STATUS = JSON.stringify({ type: "system", subtype: "status" });
const readOther = [
  toolUse("r9", "mcp__claude_ai_Claude_Docs__read", { ref: { object: "project", id: OTHER_DOC } }),
  toolResult("r9", '{"verdict":"allow","value":{"name":"Other"},"files":[]}'),
];

const update = (id: string, doc: string) =>
  toolUse(id, "mcp__claude_ai_Claude_Docs__update", {
    ref: { object: "node", id: "n1" },
    container: { kind: "project", id: doc },
  });

it.layer(NodeServices.layer)("ClaudeDocs", (it) => {
  describe("claudeDocsArgs", () => {
    const disallowed =
      "Agent,Task,TaskOutput,TaskStop,Bash,BashOutput,KillShell,PowerShell,Read,Glob,Grep,LS,LSP,NotebookRead,ListMcpResourcesTool,ReadMcpResourceTool,ReadMcpResourceDirTool,WebFetch,CronCreate,CronDelete,CronList,Monitor,ListAgents,SendMessage,SendToProject,SendToProjectContext,RemoteTrigger,ScheduleWakeup,PushNotification,Workflow,DesignSync,EnterWorktree,ExitWorktree,ReportFindings,TodoWrite,AskUserQuestion,ExitPlanMode,EnterPlanMode,SlashCommand,Artifact,ArtifactData,ArtifactComments,ArtifactCheck,Sleep,Brief,REPL,StructuredOutput";
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
      readonly source:
        | string
        | ReadonlyArray<string>
        | ((read: ReadonlyArray<string>) => ReadonlyArray<string>);
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
        name: "a CLI whose tool list is not a list of names",
        source: (read) => [
          JSON.stringify({ type: "system", subtype: "init", tools: null }),
          ...read.slice(1),
        ],
        id: DOC,
        reason: "run_failed",
      },
      {
        name: "a CLI that calls tools before any init",
        source: (read) => read.slice(1),
        id: DOC,
        reason: "run_failed",
      },
      {
        name: "a CLI whose later init cannot be read",
        source: (read) => [...read, '{"type":"system","subtype":"init","tools":["CronList"]'],
        id: DOC,
        reason: "run_failed",
      },
      {
        name: "a CLI that finishes before any init",
        source: (read) => [RESULT, ...read],
        id: DOC,
        reason: "run_failed",
      },
      {
        name: "a CLI that never lists its tools",
        source: [STATUS],
        id: DOC,
        reason: "run_failed",
        message: expect.stringContaining("without listing its tools"),
      },
      {
        name: "a CLI whose later init loads a tool dontAsk runs",
        source: (read) => [...read, init(["CronList"])],
        id: DOC,
        reason: "run_failed",
        message: expect.stringContaining("CronList"),
      },
      {
        name: "a run that also read another doc",
        source: (read) => [...read, ...readOther],
        id: DOC,
        reason: "run_failed",
        message: expect.stringContaining(OTHER_DOC),
      },
      {
        name: "a tab the CLI replaced for its size",
        source: (read) =>
          read.map((line) =>
            isResultFor(READ_EXPORT_ID)(line)
              ? toolResult(
                  READ_EXPORT_ID,
                  "Error: result (1,234,567 characters) exceeds maximum allowed tokens. Output has been saved to /tmp/claude-docs/export.txt.",
                )
              : line,
          ),
        id: DOC,
        reason: "run_failed",
        message: expect.stringContaining("too large"),
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
          LOCKED,
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
        const lines =
          typeof source === "string"
            ? yield* fixture(source)
            : typeof source === "function"
              ? source(yield* fixture("read"))
              : source;
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
        "a landed update followed by a refused one",
        DOC,
        (edit) => [
          ...edit,
          update("t9", DOC),
          toolResult("t9", '{"verdict":"deny","reason":"guard_mismatch"}', true),
        ],
        { reason: "altered", url: DOC_URL, message: expect.stringContaining("guard_mismatch") },
      ],
      [
        "a guard mismatch retried until it landed",
        DOC,
        (edit) => [
          ...edit.map(denyUpdate),
          update("t9", DOC),
          toolResult("t9", '{"verdict":"allow","rev":5}'),
        ],
        { url: DOC_URL },
      ],
      [
        "a refused update between two landed ones",
        DOC,
        (edit) => [
          ...edit,
          update("t9", DOC),
          toolResult("t9", '{"verdict":"deny","reason":"bad_request","detail":"op:unknown"}', true),
          update("t10", DOC),
          toolResult("t10", '{"verdict":"allow","rev":6}'),
        ],
        { reason: "altered", url: DOC_URL, message: expect.stringContaining("bad_request") },
      ],
      [
        "an update whose result has no verdict",
        DOC,
        (edit) =>
          edit.map((line) =>
            isResultFor(EDIT_UPDATE_ID)(line)
              ? toolResult(EDIT_UPDATE_ID, "Error: upstream connection reset", true)
              : line,
          ),
        { reason: "outcome_unknown" },
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
        "an edit of another doc and an update with no result",
        DOC,
        (edit) => [
          ...edit,
          update("t9", OTHER_DOC),
          toolResult("t9", '{"verdict":"allow","rev":1}'),
          update("t10", DOC),
        ],
        { reason: "outcome_unknown", url: DOC_URL, message: expect.stringContaining(OTHER_DOC) },
      ],
      [
        "a read that names no doc after the edit landed",
        DOC,
        (edit) => [
          ...edit,
          toolUse("r9", "mcp__claude_ai_Claude_Docs__read", { ref: { object: "node", id: "n9" } }),
          toolResult("r9", '{"verdict":"allow","value":{}}'),
        ],
        { reason: "altered", url: DOC_URL, message: expect.stringContaining("no doc") },
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
      [
        "a birth and an edit of an existing doc",
        [
          toolUse("b1", batch, sent),
          toolResult("b1", ack),
          toolUse("b2", batch, { container: { kind: "project", id: OTHER_DOC }, batch: [] }),
          toolResult("b2", '{"verdict":"allow","rev":2}'),
        ],
        {
          reason: "altered",
          url: DOC_URL,
          message: `The doc was created. Claude edited another doc (${OTHER_DOC}). Check it on claude.ai.`,
        },
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
        "altered markdown and a tool outside the plan",
        [
          toolUse("b1", batch, createBatchInput("Q3 plan", "Ship it.")),
          toolResult("b1", ack),
          toolUse("w1", "WebFetch", {}),
        ],
        { reason: "altered", url: DOC_URL, message: expect.stringMatching(/edit[\s\S]*WebFetch/) },
      ],
      [
        "two births and a result with no verdict",
        [
          toolUse("b1", batch, sent),
          toolResult("b1", ack),
          toolUse("b2", batch, sent),
          toolResult("b2", `{"verdict":"allow","created":{"bound":true}}\nOpen it: ${OTHER_URL}`),
          toolUse("b3", batch, sent),
          toolResult("b3", "Error: upstream connection reset", true),
        ],
        { reason: "outcome_unknown", url: DOC_URL, message: expect.stringContaining(OTHER_URL) },
      ],
      [
        "a birth with no link and a lost result",
        [
          toolUse("b1", batch, sent),
          toolResult("b1", '{"verdict":"allow","created":{"bound":true}}'),
          toolUse("b2", batch, sent),
        ],
        { reason: "outcome_unknown", message: expect.stringContaining("no link") },
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
      expect(
        interpretCreate(sent, collectConnectorCalls([LOCKED, ...lines], PLANS.create)),
      ).toMatchObject(expected);
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
      // A TERM would run the trap and leave a file in the run's directory.
      name: "kills a CLI that loads a tool dontAsk runs",
      script: () =>
        `trap 'touch got-term' TERM\nprintf '%s\\n' '${init(["ToolSearch", "CronList"])}'\nsleep 30 &\nwait`,
      call: "read",
      expected: { reason: "run_failed", message: expect.stringContaining("CronList") },
    },
    {
      name: "fails a CLI that never lists its tools",
      script: () => `printf '%s\\n' '${STATUS}'`,
      call: "read",
      expected: {
        reason: "run_failed",
        message: expect.stringContaining("without listing its tools"),
      },
    },
    {
      name: "keeps a landed edit's link through a flood of stderr",
      script: (transcript) =>
        `head -c 1000000 /dev/zero | tr '\\0' x >&2\ncat '${transcript}'\nexit 1`,
      call: "edit",
      expected: { reason: "outcome_unknown", url: DOC_URL },
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
