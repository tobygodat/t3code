import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { promptLinkAppPath } from "@t3tools/shared/promptLinks";
import { readPairingAppLink, resolveRemotePairingTarget } from "@t3tools/shared/remote";
import { useRouter } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import * as Stream from "effect/Stream";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { CLAUDE_PANEL_OPEN, opensAsClaudeArtifact } from "../../browser/claudeArtifactLinks";
import { openFileInPreview, openUrlInPreview } from "../../browser/openFileInPreview";
import { useBrowserPanelThread } from "../../browser/useBrowserPanelThread";
import { requestConfirmDialog } from "../../confirmDialog";
import { connectPairing } from "../../connection/onboarding";
import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import { useClientSettings } from "../../hooks/useSettings";
import { useOpenChangeRequestLink } from "../../lib/openPullRequestLink";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import { assetEnvironment } from "../../state/assets";
import { readProject, readThreadShell } from "../../state/entities";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironment } from "../../state/environments";
import { previewEnvironment } from "../../state/preview";
import { allReachableShellsLiveAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { stackedThreadToast, toastManager } from "../ui/toast";

/** A link handed over by the OS is a plain click: nothing about it asks for the browser. */
const externalClick = {
  preventDefault() {},
  stopPropagation() {},
  metaKey: false,
  ctrlKey: false,
};

/** Resolves once every reachable environment has reported its projects or settled offline. */
const projectsSettled = (): Promise<void> =>
  Effect.runPromise(
    AtomRegistry.toStream(appAtomRegistry, allReachableShellsLiveAtom).pipe(
      Stream.filter((settled) => settled),
      Stream.runHead,
      Effect.asVoid,
    ),
  );

export function DesktopWebLinkCoordinator() {
  const router = useRouter();
  const primaryEnvironment = usePrimaryEnvironment();
  const openPullRequestsInApp = useClientSettings((settings) => settings.pullRequestLinksOpenInApp);
  const openChangeRequest = useOpenChangeRequestLink();
  const panelThread = useBrowserPanelThread();
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const connectPairingEnvironment = useAtomCommand(connectPairing, { reportFailure: false });
  const httpBaseUrl = useEnvironmentHttpBaseUrl(primaryEnvironment?.environmentId ?? null);
  const queueRef = useRef(Promise.resolve());
  const pairedUrlsRef = useRef(new Set<string>());
  const webLinks = window.desktopBridge?.webLinks;
  // A sync IPC read; the setting only changes across a relaunch.
  const [localEnvironmentDisabled] = useState(isLocalEnvironmentDisabled);
  // With Local environment disabled there is no primary to wait for, so links run against the
  // saved remote environments instead of waiting forever.
  const ready =
    webLinks !== undefined &&
    (localEnvironmentDisabled ||
      (primaryEnvironment?.connection.phase === "connected" &&
        primaryEnvironment.serverConfig !== null));

  const reportFailure = (url: string, description = url) =>
    toastManager.add(
      stackedThreadToast({ type: "error", title: "Could not open the link", description }),
    );

  const reportPairingFailure = (error: unknown) =>
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not add backend",
        description: error instanceof Error ? error.message : "Failed to add backend.",
      }),
    );

  // Any page can open a pairing link, so the user confirms the host before its one-time token is spent.
  const pairFromLink = async (pairingUrl: string) => {
    // A repeated click would only ask again and then fail on the spent one-time token.
    if (pairedUrlsRef.current.has(pairingUrl)) return;
    // The origin keeps the scheme visible, so a plain HTTP backend is not mistaken for HTTPS.
    let origin: string;
    try {
      origin = new URL(resolveRemotePairingTarget({ pairingUrl }).httpBaseUrl).origin;
    } catch (error) {
      reportPairingFailure(error);
      return;
    }
    const confirmed = (await requestConfirmDialog(`Add the backend at ${origin}?`)) ?? false;
    if (!confirmed) return;
    const result = await connectPairingEnvironment({ pairingUrl });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) reportPairingFailure(squashAtomCommandFailure(result));
      return;
    }
    pairedUrlsRef.current.add(pairingUrl);
    toastManager.add({
      type: "success",
      title: "Backend added",
      description: "The environment is saved and will reconnect on app startup.",
    });
  };

  const openInBrowser = useEffectEvent(async (url: string) => {
    const isFile = url.startsWith("file:");
    // Only this machine's environment serves files, so fail before starting a thread.
    if (isFile && httpBaseUrl === null) {
      reportFailure(url);
      return;
    }
    const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
    // HTML files are served by this machine's environment, and claude.ai docs open with the
    // sign-in only its tabs hold, so only its threads can take them.
    const claudeDoc =
      primaryEnvironmentId !== null && opensAsClaudeArtifact(url, primaryEnvironmentId);
    const threadRef = await panelThread(url, isFile || claudeDoc ? primaryEnvironmentId : null);
    if (threadRef === null) return;
    const result = isFile
      ? httpBaseUrl === null
        ? null
        : await openFileInPreview({
            threadRef,
            filePath: decodeURIComponent(new URL(url).pathname),
            workspaceRoot: undefined,
            httpBaseUrl,
            createAssetUrl,
            openPreview,
          })
      : await openUrlInPreview({
          threadRef,
          url,
          openPreview,
          ...(claudeDoc ? CLAUDE_PANEL_OPEN : {}),
        });
    if (result === null) {
      reportFailure(url);
      return;
    }
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      reportFailure(url, error instanceof Error ? error.message : url);
    }
  });

  const openLink = useEffectEvent(async (url: string) => {
    const pairingUrl = readPairingAppLink(url);
    if (pairingUrl !== null) {
      await pairFromLink(pairingUrl);
      return;
    }
    const appPath = promptLinkAppPath(url);
    if (appPath !== null) {
      await router.navigate({ href: appPath });
      return;
    }
    const routeParams = router.state.matches.at(-1)?.params ?? {};
    const routeTarget = resolveThreadRouteTarget(routeParams);
    const activeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : undefined;
    const activeThread = activeThreadRef ? readThreadShell(activeThreadRef) : null;
    const activeProject =
      activeThread && activeThreadRef
        ? readProject(scopeProjectRef(activeThreadRef.environmentId, activeThread.projectId))
        : null;
    const commitThreadRef =
      activeThread &&
      sourceControlClients.parseCommitUrl(url, activeProject?.repositoryIdentity?.provider) !== null
        ? activeThreadRef
        : undefined;
    // A commit the thread's workspace lacks continues here, after its lookup.
    const openUnavailableCommit = () => {
      queueRef.current = queueRef.current.then(() => openInBrowser(url)).catch(() => undefined);
    };
    if (openChangeRequest(externalClick, url, commitThreadRef, undefined, openUnavailableCommit))
      return;
    await openInBrowser(url);
  });

  const receiveLink = useEffectEvent((url: string) => {
    // A connected server publishes its config before its project snapshot, so a source control
    // link delivered at launch would miss its project and fall through to the browser. Hold
    // those links until discovery settles; an ordinary link never waits for it.
    // Discovery never settles without the local environment, so those links do not wait.
    const hold =
      openPullRequestsInApp &&
      !localEnvironmentDisabled &&
      (sourceControlClients.parseChangeRequestUrl(url) !== null ||
        sourceControlClients.parseCommitUrl(url) !== null)
        ? projectsSettled()
        : Promise.resolve();
    void hold.then(() => {
      queueRef.current = queueRef.current.then(() => openLink(url)).catch(() => undefined);
    });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to desktop web link opens over the bridge and marks the renderer ready
  useEffect(() => {
    if (!ready || webLinks === undefined) return;
    let subscribed = true;
    const unsubscribe = webLinks.onOpen(receiveLink);
    queueMicrotask(() => {
      if (subscribed) void webLinks.setReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void webLinks.setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [ready, webLinks]);

  return null;
}
