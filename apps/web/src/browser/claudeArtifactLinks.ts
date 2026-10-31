import {
  DEFAULT_BROWSER_PROFILE_ID,
  type EnvironmentId,
  parseClaudeArtifactUrl,
} from "@t3tools/contracts";

import { isElectron } from "~/env";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { primaryServerSettingsAtom } from "~/state/server";

/**
 * Desktop and the primary environment only: the Default profile's Electron partition is keyed by
 * environment, so the claude.ai sign-in made from Settings exists only in that environment's tabs.
 */
export function claudeArtifactsActiveFor(environmentId: EnvironmentId): boolean {
  return (
    isElectron &&
    environmentId === appAtomRegistry.get(primaryEnvironmentIdAtom) &&
    appAtomRegistry.get(primaryServerSettingsAtom).claudeArtifactsEnabled
  );
}

/** The desktop runtime's Default profile holds the claude.ai sign-in; the server browser does not. */
export const CLAUDE_PANEL_OPEN = {
  runtime: "desktop",
  profileId: DEFAULT_BROWSER_PROFILE_ID,
} as const;

export const claudeArtifactOpenFor = (url: string, environmentId: EnvironmentId) =>
  claudeArtifactsActiveFor(environmentId) && parseClaudeArtifactUrl(url) !== null
    ? CLAUDE_PANEL_OPEN
    : {};
