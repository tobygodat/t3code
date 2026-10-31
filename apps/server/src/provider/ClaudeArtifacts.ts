import {
  type ClaudeArtifactId,
  type ClaudeArtifactReadResult,
  ClaudeArtifactsError,
  type ClaudeArtifactWrite,
  type ClaudeArtifactWriteResult,
  pickClaudeDocsInstance,
  ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";

const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");

export class ClaudeArtifacts extends Context.Service<
  ClaudeArtifacts,
  {
    /**
     * Whether an MCP caller gets the claude.ai Docs tools: the setting is on, this is the desktop
     * server, and the caller is a T3 thread whose provider is not Claude, which has them natively.
     */
    readonly offeredTo: (
      thread: { readonly providerInstanceId: ProviderInstanceId } | undefined,
    ) => Effect.Effect<boolean>;
    readonly read: (
      id: ClaudeArtifactId,
    ) => Effect.Effect<ClaudeArtifactReadResult, ClaudeArtifactsError>;
    readonly write: (
      request: ClaudeArtifactWrite,
    ) => Effect.Effect<ClaudeArtifactWriteResult, ClaudeArtifactsError>;
  }
>()("t3/provider/ClaudeArtifacts") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const enabled = settings.getSettings.pipe(
    Effect.map((current) => config.mode === "desktop" && current.claudeArtifactsEnabled),
    Effect.orElseSucceed(() => false),
  );

  const offeredTo = Effect.fn("ClaudeArtifacts.offeredTo")(function* (
    thread: { readonly providerInstanceId: ProviderInstanceId } | undefined,
  ) {
    if (thread === undefined || !(yield* enabled)) return false;
    const instance = yield* registry.getInstance(thread.providerInstanceId);
    return instance !== undefined && instance.driverKind !== CLAUDE_DRIVER_KIND;
  });

  const docs = Effect.fn("ClaudeArtifacts.docs")(function* () {
    if (!(yield* enabled)) {
      return yield* new ClaudeArtifactsError({
        reason: "disabled",
        message: "Claude artifacts is off. Turn it on in the desktop app under Settings → Browser.",
      });
    }
    const instances = yield* registry.listInstances;
    const snapshots = yield* Effect.forEach(instances, (instance) => instance.snapshot.getSnapshot);
    const chosen = pickClaudeDocsInstance(snapshots);
    const port = instances.find((instance) => instance.instanceId === chosen)?.claudeDocs;
    if (port === undefined) {
      return yield* new ClaudeArtifactsError({
        reason: "no_claude_login",
        message:
          "No Claude provider is signed in with a claude.ai account. Sign in to Claude Code with `claude /login`, then try again.",
      });
    }
    return port;
  });

  const read = Effect.fn("ClaudeArtifacts.read")(function* (id: ClaudeArtifactId) {
    return yield* (yield* docs()).read(id);
  });

  const write = Effect.fn("ClaudeArtifacts.write")(function* (request: ClaudeArtifactWrite) {
    return yield* (yield* docs()).write(request);
  });

  return ClaudeArtifacts.of({ offeredTo, read, write });
});

export const layer = Layer.effect(ClaudeArtifacts, make);
