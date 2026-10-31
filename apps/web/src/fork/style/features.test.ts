import { describe, expect, it } from "vite-plus/test";

import { FORK_STYLE_FEATURES, parseEnabledForkStyle, serializeEnabledForkStyle } from "./features";

const ALL_IDS = FORK_STYLE_FEATURES.map((feature) => feature.id);

describe("parseEnabledForkStyle", () => {
  it.each([
    ["nothing stored", null],
    ["malformed JSON", "{off:"],
    ["the wrong shape", JSON.stringify({ off: "mascot" })],
    ["a non-object", JSON.stringify(["mascot"])],
  ])("enables every feature for %s", (_, raw) => {
    expect([...parseEnabledForkStyle(raw)]).toEqual(ALL_IDS);
  });

  it("turns off only the stored ids and ignores unknown ones", () => {
    const enabled = parseEnabledForkStyle(
      JSON.stringify({ off: ["mascot", "retired-feature", "glass"] }),
    );
    expect([...enabled]).toEqual(ALL_IDS.filter((id) => id !== "mascot" && id !== "glass"));
  });

  it("round-trips through the stored form", () => {
    const enabled = new Set(ALL_IDS.filter((id) => id !== "turn-rise"));
    const stored = serializeEnabledForkStyle(enabled);
    expect(JSON.parse(stored)).toEqual({ off: ["turn-rise"] });
    expect(parseEnabledForkStyle(stored)).toEqual(enabled);
  });
});
