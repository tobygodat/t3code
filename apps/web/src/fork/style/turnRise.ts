import { useLayoutEffect, useRef } from "react";

import type { MessagesTimelineRow } from "../../components/chat/MessagesTimeline.logic";

export const TURN_RISE_MS = 320;

export interface TimelineSnapshot {
  readonly threadKey: string;
  readonly known: ReadonlySet<string>;
}

/**
 * The rows a timeline showed when it first had any are its snapshot and never arrive. Later ids
 * arrive only when appended after the last known row, so a page of older history loading above
 * stays still, and only while the page is visible.
 */
export function observeTimeline(
  snapshot: TimelineSnapshot | null,
  threadKey: string,
  rowIds: readonly string[],
  input: {
    readonly visible: boolean;
    readonly now: number;
    readonly arrivals: Map<string, number>;
  },
): TimelineSnapshot | null {
  if (snapshot === null || snapshot.threadKey !== threadKey || snapshot.known.size === 0) {
    return rowIds.length === 0 ? null : { threadKey, known: new Set(rowIds) };
  }
  const lastKnownIndex = rowIds.findLastIndex((id) => snapshot.known.has(id));
  const fresh = rowIds.filter((id) => !snapshot.known.has(id));
  if (fresh.length === 0) return snapshot;
  if (input.visible) {
    for (const [id, at] of input.arrivals) {
      if (input.now - at >= TURN_RISE_MS) input.arrivals.delete(id);
    }
    for (let index = lastKnownIndex + 1; index < rowIds.length; index++) {
      const id = rowIds[index]!;
      if (!snapshot.known.has(id)) input.arrivals.set(id, input.now);
    }
  }
  return { threadKey, known: new Set([...snapshot.known, ...fresh]) };
}

export function hasArrived(arrivals: ReadonlyMap<string, number>, rowId: string, now: number) {
  const at = arrivals.get(rowId);
  return at !== undefined && now - at < TURN_RISE_MS;
}

const arrivals = new Map<string, number>();

export function useTurnRise(threadKey: string, rows: readonly MessagesTimelineRow[]): void {
  const snapshot = useRef<TimelineSnapshot | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- LegendList mounts new rows from its own layout effect, after this one, so they read the arrival when they first render
  useLayoutEffect(() => {
    snapshot.current = observeTimeline(
      snapshot.current,
      threadKey,
      rows.flatMap((row) => (row.kind === "message" ? [row.id] : [])),
      { visible: document.visibilityState === "visible", now: performance.now(), arrivals },
    );
  }, [threadKey, rows]);
}

export function turnRiseArrived(rowId: string): true | undefined {
  return hasArrived(arrivals, rowId, performance.now()) || undefined;
}
