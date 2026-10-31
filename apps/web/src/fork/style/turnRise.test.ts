import { describe, expect, it } from "vite-plus/test";

import { TURN_RISE_MS, hasArrived, observeTimeline, type TimelineSnapshot } from "./turnRise";

function timeline() {
  const arrivals = new Map<string, number>();
  let snapshot: TimelineSnapshot | null = null;
  return {
    show(threadKey: string, rowIds: string[], now: number, visible = true) {
      snapshot = observeTimeline(snapshot, threadKey, rowIds, { visible, now, arrivals });
    },
    arrived: (rowId: string, now: number) => hasArrived(arrivals, rowId, now),
  };
}

describe("turn rise arrivals", () => {
  it("never raises the rows a thread opens with, even when they load after an empty first render", () => {
    const list = timeline();
    list.show("thread-a", [], 0);
    list.show("thread-a", ["m1", "m2"], 10);
    expect(list.arrived("m1", 10)).toBe(false);
    expect(list.arrived("m2", 10)).toBe(false);
  });

  it("raises an appended row once, for its window only", () => {
    const list = timeline();
    list.show("thread-a", ["m1"], 0);
    list.show("thread-a", ["m1", "m2"], 100);
    expect(list.arrived("m2", 100)).toBe(true);
    expect(list.arrived("m2", 100 + TURN_RISE_MS - 1)).toBe(true);

    list.show("thread-a", ["m1", "m2"], 100 + TURN_RISE_MS);
    expect(list.arrived("m2", 100 + TURN_RISE_MS)).toBe(false);
    list.show("thread-a", ["m1", "m2", "m3"], 1000);
    expect(list.arrived("m2", 1000)).toBe(false);
    expect(list.arrived("m3", 1000)).toBe(true);
  });

  it("keeps older history loading above the known rows still", () => {
    const list = timeline();
    list.show("thread-a", ["m3", "m4"], 0);
    list.show("thread-a", ["m1", "m2", "m3", "m4"], 50);
    expect(list.arrived("m1", 50)).toBe(false);
    expect(list.arrived("m2", 50)).toBe(false);
  });

  it("does not raise rows that arrive while the page is hidden", () => {
    const list = timeline();
    list.show("thread-a", ["m1"], 0);
    list.show("thread-a", ["m1", "m2"], 50, false);
    list.show("thread-a", ["m1", "m2"], 60);
    expect(list.arrived("m2", 60)).toBe(false);
  });

  it("takes a fresh snapshot when the timeline switches threads", () => {
    const list = timeline();
    list.show("thread-a", ["a1"], 0);
    list.show("thread-b", ["b1", "b2"], 50);
    expect(list.arrived("b1", 50)).toBe(false);
    expect(list.arrived("b2", 50)).toBe(false);

    list.show("thread-a", ["a1", "a2"], 100);
    expect(list.arrived("a2", 100)).toBe(false);

    list.show("thread-a", ["a1", "a2", "a3"], 200);
    list.show("thread-b", ["b1", "b2"], 220);
    list.show("thread-a", ["a1", "a2", "a3"], 250);
    expect(list.arrived("a3", 250)).toBe(false);
  });
});
