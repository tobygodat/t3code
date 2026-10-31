import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { recordVisitForThread } from "~/browserHistoryStore";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { readLocalApi } from "~/localApi";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  canOpenLinksInApp,
  resolveBrowserLinkTargetPreference,
  resolveLinkTarget,
} from "./browserLinkTarget";
import {
  CLAUDE_PANEL_OPEN,
  claudeArtifactsActiveFor,
  opensAsClaudeArtifact,
} from "./claudeArtifactLinks";
import { BrowserSettingsReadError, openUrlInPreview } from "./openFileInPreview";

const NO_MODIFIER = { metaKey: false, ctrlKey: false } as const;

/** Rejects on settings read failure without opening a browser, or if the system-browser fallback fails. */
export function useOpenLink(threadRef: ScopedThreadRef | null | undefined): (
  url: string,
  options?: {
    readonly event?: {
      readonly metaKey: boolean;
      readonly ctrlKey: boolean;
      readonly button?: number | undefined;
    };
    readonly threadRef?: ScopedThreadRef | undefined;
  },
) => Promise<void> {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  return async (url, options = {}) => {
    const targetThreadRef = options.threadRef ?? threadRef;
    const target = resolveLinkTarget({
      url,
      event: options.event ?? NO_MODIFIER,
      preference: await resolveBrowserLinkTargetPreference(),
      canOpenInApp: canOpenLinksInApp(targetThreadRef),
      claudeArtifacts: targetThreadRef
        ? claudeArtifactsActiveFor(targetThreadRef.environmentId)
        : false,
    });
    if (target === "app" && targetThreadRef) {
      const claudeDoc = opensAsClaudeArtifact(url, targetThreadRef.environmentId);
      const result = await openUrlInPreview({
        threadRef: targetThreadRef,
        url,
        openPreview,
        ...(claudeDoc ? CLAUDE_PANEL_OPEN : {}),
      });
      if (isAtomCommandInterrupted(result)) return;
      if (result._tag === "Success") {
        recordVisitForThread(targetThreadRef, url);
        return;
      }
      const failure = squashAtomCommandFailure(result);
      if (failure instanceof BrowserSettingsReadError) throw failure;
      // The system browser lacks the panel's claude.ai sign-in, so a forced open stops here.
      console.error(result.cause);
      if (claudeDoc) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not open the claude.ai doc",
            description: "⌘/Ctrl-click the link to open it in your default browser.",
          }),
        );
        return;
      }
    }
    const api = readLocalApi();
    if (!api) throw new Error("Link opening is unavailable.");
    await api.shell.openExternal(url);
  };
}
