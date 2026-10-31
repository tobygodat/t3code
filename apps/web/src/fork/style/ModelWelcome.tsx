// Ported from MonoCode (MIT, github.com/hardbeat920/monocode). See fork/MONOCODE-LICENSE.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

import { observeResize } from "../../lib/observeResize";
import { useForkStyleFeature } from "./store";
import "./welcome.css";

type WelcomeKind = "astra" | "opus";

const ASTRA_MS = 7600;
const OPUS_MS = 7000;

let current: { readonly kind: WelcomeKind; readonly run: number } | null = null;
let runs = 0;
const listeners = new Set<() => void>();

function setCurrent(next: typeof current) {
  current = next;
  for (const listener of listeners) listener();
}

function welcomeKind(model: string): WelcomeKind | null {
  if (/(^|[^a-z0-9])astra([^a-z0-9]|$)/i.test(model)) return "astra";
  if (/(^|[^a-z0-9])opus[\s-]?5[.-]5(?![0-9.])/i.test(model)) return "opus";
  return null;
}

export function announceModelPick(model: string): void {
  const kind = welcomeKind(model);
  setCurrent(kind === null ? null : { kind, run: ++runs });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const dismiss = () => setCurrent(null);

/** One-shot scene over the chat pane after a model pick. Mount inside the pane's positioned box. */
export function ModelWelcome() {
  const enabled = useForkStyleFeature("model-welcome");
  const welcome = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  if (!enabled || welcome === null) return null;
  return welcome.kind === "astra" ? (
    <AstraWelcome key={welcome.run} />
  ) : (
    <OpusWelcome key={welcome.run} />
  );
}

function useDismissAfter(durationMs: number) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends the one-shot scene on a timer, or at once when the system asks for reduced motion
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      dismiss();
      return;
    }
    const onMotionChange = () => {
      if (reducedMotion.matches) dismiss();
    };
    const timer = window.setTimeout(dismiss, durationMs);
    reducedMotion.addEventListener("change", onMotionChange);
    return () => {
      window.clearTimeout(timer);
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, [durationMs]);
}

const STARS = Array.from({ length: 38 }, (_, index) => ({
  key: `star-${index}`,
  style: {
    "--star-x": `${8 + ((index * 37) % 125)}%`,
    "--star-y": `${-12 + ((index * 19) % 48)}%`,
    "--star-delay": `${0.35 + index * 0.12}s`,
    "--star-duration": `${1.4 + (index % 5) * 0.22}s`,
    "--star-length": `${index % 9 === 0 ? 190 : 45 + ((index * 23) % 95)}px`,
    "--star-width": index % 9 === 0 ? "2px" : "1px",
    "--star-brightness": index % 3 === 0 ? 0.95 : 0.5,
  } as CSSProperties,
}));

const SPARKLES = Array.from({ length: 36 }, (_, index) => ({
  key: `sparkle-${index}`,
  cross: index % 6 === 0,
  style: {
    "--spark-x": `${3 + ((index * 37) % 94)}%`,
    "--spark-y": `${4 + ((index * 23) % 86)}%`,
    "--spark-size": index % 6 === 0 ? "9px" : `${1 + (index % 3)}px`,
    "--spark-delay": `${0.2 + ((index * 7) % 24) * 0.12}s`,
    "--spark-duration": `${2.2 + (index % 4) * 0.45}s`,
  } as CSSProperties,
}));

function AstraWelcome() {
  useDismissAfter(ASTRA_MS);
  return (
    <div
      data-fork-welcome="astra"
      aria-hidden="true"
      style={{ "--astra-duration": `${ASTRA_MS}ms` } as CSSProperties}
    >
      <div data-astra="glow" />
      <div data-astra="solar-system">
        <div data-astra="solar-corona" />
        <div data-astra="solar-wave" />
        <div data-astra="solar-wave late" />
        <div data-astra="solar-orbit">
          <span />
        </div>
        <div data-astra="solar-orbit outer">
          <span />
        </div>
        <div data-astra="solar-core" />
      </div>
      {SPARKLES.map(({ key, cross, style }) => (
        <span key={key} data-astra={cross ? "sparkle cross" : "sparkle"} style={style} />
      ))}
      {STARS.map(({ key, style }) => (
        <div key={key} data-astra="star-flight" style={style}>
          <span data-astra="star" />
        </div>
      ))}
    </div>
  );
}

// A short phrase: it climbs, hesitates, and resolves on the middle line.
const MELODY = [
  [0.06, -3],
  [0.13, -1],
  [0.2, 1],
  [0.28, 0],
  [0.36, 2],
  [0.44, 4],
  [0.52, 3],
  [0.6, 1],
  [0.68, 2],
  [0.77, 0],
] as const;

const MOTES = Array.from({ length: 26 }, (_, index) => ({
  key: `mote-${index}`,
  ring: index % 5 === 0,
  style: {
    "--mote-x": `${4 + ((index * 41) % 92)}%`,
    "--mote-y": `${20 + ((index * 29) % 72)}%`,
    "--mote-size": `${2 + (index % 4)}px`,
    "--mote-delay": `${0.5 + ((index * 11) % 30) * 0.12}s`,
    "--mote-duration": `${2.6 + (index % 5) * 0.4}s`,
    "--mote-drift": `${(index % 2 ? 1 : -1) * (6 + (index % 7) * 3)}px`,
  } as CSSProperties,
}));

const MIN_STAGE_BELOW = 140;
const MAX_STAGE_ABOVE = 240;

interface Stage {
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The free space under a centered composer, or a band just above a docked one. */
function opusStage(
  paneHeight: number,
  composer: { top: number; bottom: number } | undefined,
): { top: number; height: number } {
  if (!composer) {
    const top = Math.round(paneHeight * 0.55);
    return { top, height: paneHeight - top };
  }
  const below = paneHeight - composer.bottom;
  if (below >= MIN_STAGE_BELOW) return { top: composer.bottom, height: below };
  const height = Math.max(0, Math.min(MAX_STAGE_ABOVE, composer.top));
  return { top: composer.top - height, height };
}

/** Five lines cross the stage edge to edge, rising as a loose wave into a single thread. */
function sceneLayout({ width, height }: Stage) {
  const endY = height * 0.42;
  const rise = height * 0.86 - endY;
  const staffY = (t: number, step: number) =>
    endY +
    rise * (1 - t) ** 1.7 +
    Math.sin(t * Math.PI * 2.4 + 0.3) * Math.min(20, height * 0.08) * (1 - t) -
    (step / 2) * 11 * (1 - 0.84 * t);

  const lines = [-4, -2, 0, 2, 4].map((step) => ({
    key: `line-${step}`,
    path: Array.from({ length: 121 }, (_, index) => {
      const t = index / 120;
      return `${index ? "L" : "M"}${(t * width).toFixed(1)} ${staffY(t, step).toFixed(1)}`;
    }).join(" "),
  }));
  const notes = MELODY.map(([t, step], index) => ({
    key: `note-${index}`,
    style: {
      "--note-x": `${t * width}px`,
      "--note-y": `${staffY(t, step)}px`,
      "--note-size": `${12.6 * (1 - 0.84 * t)}px`,
      "--note-delay": `${1.05 + index * 0.23}s`,
    } as CSSProperties,
    stemDown: step >= 1,
  }));
  return { lines, notes };
}

function OpusWelcome() {
  useDismissAfter(OPUS_MS);
  const rootRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the pane and composer with a ResizeObserver to place the staff before paint
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const composer = root.parentElement?.querySelector('[data-chat-composer-stack="true"]');
    const measure = () => {
      const pane = root.getBoundingClientRect();
      const box = composer?.getBoundingClientRect();
      const { top, height } = opusStage(
        pane.height,
        box && { top: box.top - pane.top, bottom: box.bottom - pane.top },
      );
      const next = {
        top: Math.round(top),
        width: Math.round(pane.width),
        height: Math.round(height),
      };
      setStage((previous) =>
        previous &&
        previous.top === next.top &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      );
    };
    measure();
    return observeResize(composer ? [root, composer] : [root], measure);
  }, []);

  const scene = stage && stage.height > 0 ? sceneLayout(stage) : null;

  return (
    <div
      ref={rootRef}
      data-fork-welcome="opus"
      aria-hidden="true"
      style={{ "--opus-duration": `${OPUS_MS}ms` } as CSSProperties}
    >
      <div data-opus="glow" />
      {stage && scene ? (
        <div data-opus="stage" style={{ top: stage.top, height: stage.height }}>
          {MOTES.map(({ key, ring, style }) => (
            <span key={key} data-opus={ring ? "mote ring" : "mote"} style={style} />
          ))}
          <div data-opus="staff">
            {scene.lines.map(({ key, path }, index) => (
              <svg
                key={key}
                data-opus="staff-line"
                style={{ "--line-delay": `${0.15 + index * 0.09}s` } as CSSProperties}
              >
                <path d={path} />
              </svg>
            ))}
            {scene.notes.map(({ key, style, stemDown }) => (
              <span key={key} data-opus={stemDown ? "note stem-down" : "note"} style={style}>
                <span data-opus="note-head" />
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
