import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useScratchProject } from "~/hooks/useScratchProject";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { usePrimaryEnvironment } from "~/state/environments";
import { resolveThreadRouteTarget } from "~/threadRoutes";

import { isPreviewAvailableFor } from "./previewRuntime";

function threadShowingBrowser(
  routeParams: Record<string, string | undefined>,
  environmentId: EnvironmentId | null,
): ScopedThreadRef | null {
  const target = resolveThreadRouteTarget(routeParams);
  if (target === null) return null;
  let threadRef = target.kind === "server" ? target.threadRef : null;
  if (target.kind === "draft") {
    const session = useComposerDraftStore.getState().getDraftSession(target.draftId);
    if (!session || session.promotedTo) return null;
    threadRef = scopeThreadRef(session.environmentId, session.threadId);
  }
  if (threadRef === null || !isPreviewAvailableFor(threadRef.environmentId)) return null;
  if (environmentId !== null && threadRef.environmentId !== environmentId) return null;
  const surface = selectActiveRightPanelSurface(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  );
  return surface?.kind === "preview" ? threadRef : null;
}

/**
 * A thread to open `url` in when none is in hand: the routed thread if its panel already shows
 * the browser, else a new scratch thread with the panel maximized. Starts no provider turn.
 * `environmentId` restricts the routed thread to one environment.
 */
export function useBrowserPanelThread(): (
  url: string,
  environmentId: EnvironmentId | null,
) => Promise<ScopedThreadRef | null> {
  const router = useRouter();
  const primaryEnvironment = usePrimaryEnvironment();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const openThread = useNewThreadHandler();
  const reportFailure = (url: string) =>
    toastManager.add(
      stackedThreadToast({ type: "error", title: "Could not open the link", description: url }),
    );

  return async (url, environmentId) => {
    const routeParams = router.state.matches.at(-1)?.params ?? {};
    const showing = threadShowingBrowser(routeParams, environmentId);
    if (showing !== null) return showing;
    const scratchId = scratchEnvironmentId(primaryEnvironment?.environmentId ?? null);
    if (scratchId === null) {
      reportFailure(url);
      return null;
    }
    const project = await openScratchProject(scratchId, "Could not open the link");
    if (!project) return null;
    const opened = await openThread(scopeProjectRef(project.environmentId, project.id));
    if (!opened) {
      reportFailure(url);
      return null;
    }
    const threadRef = scopeThreadRef(project.environmentId, opened.threadId);
    useRightPanelStore.getState().requestMaximize(threadRef);
    return threadRef;
  };
}
