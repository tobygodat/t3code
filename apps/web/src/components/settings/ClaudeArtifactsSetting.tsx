import { useAtomValue } from "@effect/atom-react";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { CLAUDE_LOGIN_URL, pickClaudeDocsInstance } from "@t3tools/contracts";
import { useState } from "react";

import { CLAUDE_PANEL_OPEN } from "~/browser/claudeArtifactLinks";
import { openUrlInPreview } from "~/browser/openFileInPreview";
import { useBrowserPanelThread } from "~/browser/useBrowserPanelThread";
import { usePrimarySettings } from "~/hooks/useSettings";
import { usePrimaryEnvironment } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { primaryServerProvidersAtom, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function ClaudeArtifactsSetting({ disabled }: { readonly disabled: boolean }) {
  const enabled = usePrimarySettings((settings) => settings.claudeArtifactsEnabled);
  const providers = useAtomValue(primaryServerProvidersAtom);
  const primaryEnvironmentId = usePrimaryEnvironment()?.environmentId ?? null;
  // Awaited, unlike updateSettings, so sign-in opens only after the server has saved the setting.
  const saveSettings = useAtomCommand(serverEnvironment.updateSettings, "Claude artifacts");
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const panelThread = useBrowserPanelThread();
  const [saving, setSaving] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const docsInstanceId = pickClaudeDocsInstance(providers);
  const docsInstance = providers.find((provider) => provider.instanceId === docsInstanceId);

  const signIn = async () => {
    const threadRef = await panelThread(CLAUDE_LOGIN_URL, primaryEnvironmentId);
    if (threadRef === null) {
      setSignInFailed(true);
      return;
    }
    const result = await openUrlInPreview({
      threadRef,
      url: CLAUDE_LOGIN_URL,
      openPreview,
      ...CLAUDE_PANEL_OPEN,
    });
    if (isAtomCommandInterrupted(result)) return;
    setSignInFailed(result._tag === "Failure");
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not open claude.ai",
        description: "Open the browser panel and try Sign in again.",
      });
    }
  };

  const change = async (checked: boolean) => {
    if (primaryEnvironmentId === null) return;
    setSaving(true);
    const result = await saveSettings({
      environmentId: primaryEnvironmentId,
      input: { patch: { claudeArtifactsEnabled: checked } },
    });
    setSaving(false);
    if (result._tag !== "Success") return;
    if (checked) await signIn();
    else setSignInFailed(false);
  };

  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("claude-artifacts")}
      settingKeys={["claudeArtifactsEnabled"]}
      description={
        <>
          Let Codex and other non-Claude agents create, read and edit your claude.ai docs through
          Claude Code, and open claude.ai artifact links here. Turning it on opens claude.ai so you
          can sign in. Agents see the tools in sessions started after you turn it on.
        </>
      }
      status={
        enabled
          ? docsInstance
            ? `Runs as ${docsInstance.displayName ?? "Claude"}${docsInstance.auth.label ? ` (${docsInstance.auth.label})` : ""}.`
            : "Sign in to Claude Code with a claude.ai account first: run claude /login."
          : undefined
      }
      control={
        <div className="flex items-center gap-2">
          {enabled && signInFailed ? (
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => void signIn()}>
              Sign in
            </Button>
          ) : null}
          <Switch
            checked={enabled}
            disabled={disabled || saving || primaryEnvironmentId === null}
            onCheckedChange={(checked) => void change(Boolean(checked))}
            aria-label="Claude artifacts"
          />
        </div>
      }
    />
  );
}
