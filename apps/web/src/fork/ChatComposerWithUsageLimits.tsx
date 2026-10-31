import { ChatComposer, type ChatComposerProps } from "~/components/chat/ChatComposer";
import { resolveThreadDetailsVisibility } from "~/components/chat/threadDetailsItems";
import type { ThreadDetailsUsageInput } from "~/components/chat/ThreadDetailsUsage";
import { useClientSettings } from "~/hooks/useSettings";
import { ComposerUsageLimitsContext } from "./ComposerUsageLimits";

/** The chat composer, with the thread's usage limits available to its context window popover. */
export function ChatComposerWithUsageLimits({
  usage,
  threadPanelOpen,
  ...props
}: ChatComposerProps & {
  readonly usage: ThreadDetailsUsageInput;
  readonly threadPanelOpen: boolean;
}) {
  const panelUsageVisible = useClientSettings(
    (settings) => resolveThreadDetailsVisibility(settings).usage,
  );
  return (
    <ComposerUsageLimitsContext
      value={{ usage, panelShowsUsage: threadPanelOpen && panelUsageVisible }}
    >
      <ChatComposer {...props} />
    </ComposerUsageLimitsContext>
  );
}
