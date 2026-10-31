// Ported from MonoCode (MIT, github.com/hardbeat920/monocode). See fork/MONOCODE-LICENSE.
import type { CSSProperties } from "react";

import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { useForkStyleFeature } from "./store";

type Hsl = readonly [h: number, s: number, l: number];
type Cell = readonly [x: number, y: number];
interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fill: string;
}
interface PixelLayers {
  readonly body: readonly PixelRect[];
  readonly open: readonly PixelRect[];
  readonly closed: readonly PixelRect[];
}

const GRID = 16;
const CELL = 1.5;
const INSET = 2;
const SIZE = 8;
const COLOR: Hsl = [280, 60, 66];
const EYE = "#263331";
const GLINT = "rgba(255,255,244,0.75)";
const TOP_LIGHT = "rgba(255,255,237,0.24)";
const LEFT_LIGHT = "rgba(255,255,237,0.13)";

const GHOST = {
  rest: [
    "..####..",
    ".######.",
    "##.##.##",
    "########",
    "########",
    "########",
    "########",
    "#.##.##.",
  ],
  talk: [
    "..####..",
    ".######.",
    "#.##.###",
    "########",
    "########",
    "########",
    "########",
    ".##.##.#",
  ],
  eyes: {
    rest: [
      [2, 2],
      [5, 2],
    ] as readonly Cell[],
    talk: [
      [1, 2],
      [4, 2],
    ] as readonly Cell[],
  },
};

function tone([h, s, l]: Hsl, amount: number): Hsl {
  return [h, s, amount >= 0 ? l + (100 - l) * amount : l * (1 + amount)];
}

function css([h, s, l]: Hsl): string {
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
  return `hsl(${Math.round(((h % 360) + 360) % 360)} ${clamp(s)}% ${clamp(l)}%)`;
}

const rect = (x: number, y: number, w: number, h: number, fill: string): PixelRect => ({
  x: INSET + x * CELL,
  y: INSET + y * CELL,
  w: w * CELL,
  h: h * CELL,
  fill,
});

function pixelLayers(talking: boolean): PixelLayers {
  const rows = talking ? GHOST.talk : GHOST.rest;
  const base: Hsl = [COLOR[0], COLOR[1] * 0.55, COLOR[2] + (82 - COLOR[2]) * 0.55];
  const filled = (x: number, y: number) => rows[y]?.[x] === "#";
  const material = (x: number, y: number) =>
    tone(y >= 6 ? tone(base, -0.08) : base, 0.04 + (7 - y) * 0.009 + (3 - x) * 0.006);

  const cells: Cell[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) if (filled(x, y)) cells.push([x, y]);
  }

  const body: PixelRect[] = [];
  const depth = 0.14;
  for (const [x, y] of cells) {
    body.push(rect(x + depth, y + depth * 0.66, 1, 1, css(tone(material(x, y), -0.32))));
  }
  for (const [x, y] of cells) {
    body.push(rect(x, y, 1, 1, css(material(x, y))));
    if (!filled(x, y - 1)) body.push(rect(x, y, 1, 0.08, TOP_LIGHT));
    if (!filled(x - 1, y)) body.push(rect(x, y, 0.06, 1, LEFT_LIGHT));
  }

  const open: PixelRect[] = [];
  const closed: PixelRect[] = [];
  for (const [x, y] of talking ? GHOST.eyes.talk : GHOST.eyes.rest) {
    open.push(rect(x, y, 1, 1, EYE));
    open.push(rect(x + 0.15, y + 0.15, 0.25, 0.25, GLINT));
    closed.push(rect(x, y, 1, 1, css(material(x, y))));
    closed.push(rect(x, y + 0.55, 1, 0.25, EYE));
  }
  return { body, open, closed };
}

const REST = pixelLayers(false);
const TALK = pixelLayers(true);

function Rects({ rects }: { rects: readonly PixelRect[] }) {
  return rects.map(({ x, y, w, h, fill }) => (
    <rect key={`${x}:${y}:${w}:${h}:${fill}`} x={x} y={y} width={w} height={h} fill={fill} />
  ));
}

function Frame({ layers }: { layers: PixelLayers }) {
  return (
    <>
      <Rects rects={layers.body} />
      <g data-pixel="eyes-open">
        <Rects rects={layers.open} />
      </g>
      <g data-pixel="eyes-closed">
        <Rects rects={layers.closed} />
      </g>
    </>
  );
}

const BLINK_OFFSET = { "--fork-blink-delay": "-2.6s" } as CSSProperties;

export function ForkMascot({ status }: { status: "idle" | "working" }) {
  const enabled = useForkStyleFeature("mascot");
  if (!enabled) return null;
  return (
    <svg
      ref={observeVisibleAnimation}
      aria-hidden
      viewBox={`0 0 ${GRID} ${GRID}`}
      overflow="visible"
      shapeRendering="crispEdges"
      data-fork-mascot={status}
      style={BLINK_OFFSET}
    >
      {status === "working" ? (
        <g data-pixel="hop">
          <g data-pixel="frame-a">
            <Frame layers={REST} />
          </g>
          <g data-pixel="frame-b">
            <Frame layers={TALK} />
          </g>
        </g>
      ) : (
        <g data-pixel="bob">
          <Frame layers={REST} />
        </g>
      )}
    </svg>
  );
}
