// Ported from MonoCode (MIT, github.com/hardbeat920/monocode). See fork/MONOCODE-LICENSE.
import type { CSSProperties } from "react";

import { useForkStyleFeature } from "./store";

const COLUMNS = 32;
const ROWS = 5;
const CENTER_COLUMN = (COLUMNS - 1) / 2;
const CENTER_ROW = (ROWS - 1) / 2;

const TILES = Array.from({ length: COLUMNS * ROWS }, (_, index) => ({
  key: `tile-${index}`,
  filled: (index * 73 + index * index * 19 + 23) % 101 < 65,
  style: {
    "--tile-distance": Math.hypot(
      ((index % COLUMNS) - CENTER_COLUMN) / CENTER_COLUMN,
      (Math.floor(index / COLUMNS) - CENTER_ROW) / CENTER_ROW,
    ),
  } as CSSProperties,
}));

const EFFORT_DESCRIPTOR_IDS: ReadonlySet<string> = new Set(["effort", "reasoningEffort"]);

function effortTone(descriptorId: string, value: string): "ultra" | "max" | null {
  if (!EFFORT_DESCRIPTOR_IDS.has(descriptorId)) return null;
  const normalized = value.toLowerCase();
  return normalized === "ultra" || normalized === "max" ? normalized : null;
}

export function EffortTileShimmer({
  descriptorId,
  value,
}: {
  descriptorId: string;
  value: string;
}) {
  const enabled = useForkStyleFeature("effort-fill");
  const tone = effortTone(descriptorId, value);
  if (!enabled || tone === null) return null;
  return (
    <span data-fork-effort-tiles={tone} aria-hidden="true">
      {TILES.map(({ key, filled, style }) => (
        <span key={key} data-fork-effort-tile={filled ? "filled" : ""} style={style} />
      ))}
    </span>
  );
}
