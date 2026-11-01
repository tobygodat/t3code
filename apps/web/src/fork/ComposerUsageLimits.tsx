import { createContext, use } from "react";

import {
  ThreadDetailsUsage,
  type ThreadDetailsUsageInput,
} from "~/components/chat/ThreadDetailsUsage";

interface ComposerUsageLimitsValue {
  readonly usage: ThreadDetailsUsageInput;
  /** The details card is open and shows its usage rows, so the popover leaves them out. */
  readonly panelShowsUsage: boolean;
}

export const ComposerUsageLimitsContext = createContext<ComposerUsageLimitsValue | null>(null);

/** The selected provider's limit windows, for the context window popover. */
export function ComposerUsageLimits() {
  const value = use(ComposerUsageLimitsContext);
  if (!value || value.panelShowsUsage) return null;
  // The usage section and its rows carry the details card's insets; trim them to the popover's.
  // Usage rows are the section grid's only tabbable children.
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2 has-[>div:last-child:empty]:hidden">
      <div className="font-medium text-muted-foreground text-xs">Usage</div>
      <div className="-mx-3.5 -mt-2 -mb-2.5 [&_.grid>[tabindex]]:px-1.5">
        <ThreadDetailsUsage {...value.usage} />
      </div>
    </div>
  );
}
