import { useSyncExternalStore } from "react";

import {
  FORK_STYLE_STORAGE_KEY,
  parseEnabledForkStyle,
  serializeEnabledForkStyle,
  type ForkStyleFeatureId,
} from "./features";

const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(FORK_STYLE_STORAGE_KEY);
  } catch {
    return null;
  }
}

let enabled = parseEnabledForkStyle(typeof window === "undefined" ? null : readStored());
if (typeof document !== "undefined") apply(enabled);

function apply(next: ReadonlySet<ForkStyleFeatureId>) {
  enabled = next;
  document.documentElement.dataset.forkStyle = [...next].join(" ");
}

function emit() {
  for (const listener of listeners) listener();
}

function handleStorage(event: StorageEvent) {
  if (event.key !== FORK_STYLE_STORAGE_KEY && event.key !== null) return;
  apply(parseEnabledForkStyle(readStored()));
  emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", handleStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", handleStorage);
  };
}

export function setForkStyleFeature(id: ForkStyleFeatureId, on: boolean): void {
  const next = new Set(enabled);
  if (on) next.add(id);
  else next.delete(id);
  try {
    window.localStorage.setItem(FORK_STYLE_STORAGE_KEY, serializeEnabledForkStyle(next));
  } catch {}
  apply(next);
  emit();
}

export function isForkStyleFeatureEnabled(id: ForkStyleFeatureId): boolean {
  return enabled.has(id);
}

export function useForkStyleFeature(id: ForkStyleFeatureId): boolean {
  return useSyncExternalStore(
    subscribe,
    () => enabled.has(id),
    () => true,
  );
}
