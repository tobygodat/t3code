import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type ForkStyleGroup = "primitives" | "motion" | "loops";

interface ForkStyleFeature {
  readonly id: string;
  readonly group: ForkStyleGroup;
  readonly label: string;
  readonly description: string;
}

export const FORK_STYLE_FEATURES = [
  {
    id: "buttons",
    group: "primitives",
    label: "Flat buttons",
    description: "Thin borders and no shadows on outline, ghost and icon buttons.",
  },
  {
    id: "row-fills",
    group: "primitives",
    label: "Row fills",
    description: "Soft fills that fade in on sidebar rows and menu items.",
  },
  {
    id: "glass",
    group: "primitives",
    label: "Glass popups",
    description: "Rounder menus, popovers and tooltips with a deeper blur.",
  },
  {
    id: "composer-controls",
    group: "primitives",
    label: "Composer chips",
    description: "Compact model and mode chips with a square send button.",
  },
  {
    id: "popover-open",
    group: "motion",
    label: "Popup open",
    description: "Menus and popovers scale in from the side they open on.",
  },
  {
    id: "turn-rise",
    group: "motion",
    label: "Rising messages",
    description: "New messages fade up into place as they arrive.",
  },
  {
    id: "toast-drop",
    group: "motion",
    label: "Toast drop",
    description: "Toasts drop in a short way instead of sliding the full height.",
  },
  {
    id: "effort-fill",
    group: "motion",
    label: "Effort tiles",
    description: "Ultra and max effort options light up when highlighted.",
  },
  {
    id: "working-shimmer",
    group: "loops",
    label: "Working shimmer",
    description: "A light sweeps across the Working label while the agent runs.",
  },
  {
    id: "thinking-pulse",
    group: "loops",
    label: "Thinking pulse",
    description: "The Thinking line breathes while reasoning streams in.",
  },
  {
    id: "mascot",
    group: "loops",
    label: "Mascot",
    description: "A pixel mascot hops beside Working and idles on new threads.",
  },
  {
    id: "model-welcome",
    group: "loops",
    label: "Model welcome",
    description: "A short animation plays when you pick Claude Opus 5.5 or an Astra model.",
  },
] as const satisfies readonly ForkStyleFeature[];

export type ForkStyleFeatureId = (typeof FORK_STYLE_FEATURES)[number]["id"];

export const FORK_STYLE_STORAGE_KEY = "t3code:fork-style:v1";

const FEATURE_IDS: ReadonlySet<string> = new Set(FORK_STYLE_FEATURES.map((feature) => feature.id));

const isFeatureId = (id: string): id is ForkStyleFeatureId => FEATURE_IDS.has(id);

const StoredForkStyle = Schema.fromJsonString(Schema.Struct({ off: Schema.Array(Schema.String) }));
const decodeStoredForkStyle = Schema.decodeUnknownOption(StoredForkStyle);
const encodeStoredForkStyle = Schema.encodeSync(StoredForkStyle);

export function parseEnabledForkStyle(raw: string | null): ReadonlySet<ForkStyleFeatureId> {
  const off = new Set(
    raw === null
      ? []
      : Option.match(decodeStoredForkStyle(raw), {
          onNone: () => [],
          onSome: (stored) => stored.off.filter(isFeatureId),
        }),
  );
  return new Set(FORK_STYLE_FEATURES.map((feature) => feature.id).filter((id) => !off.has(id)));
}

export function serializeEnabledForkStyle(enabled: ReadonlySet<ForkStyleFeatureId>): string {
  return encodeStoredForkStyle({
    off: FORK_STYLE_FEATURES.map((feature) => feature.id).filter((id) => !enabled.has(id)),
  });
}
