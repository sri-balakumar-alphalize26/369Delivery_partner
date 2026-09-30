/**
 * What the connected server can do, from `me.fleet.features`.
 *
 * Kept here rather than read from the session store so the adapters can ask
 * without importing the store, which imports them. The session store keeps it
 * current (see the subscription at the foot of `store/session.ts`).
 *
 * An empty list is an older server: send it nothing it has no parameter for.
 */
let current: readonly string[] = [];

export function setFeatures(features: readonly string[] | undefined): void {
  current = features ?? [];
}

export function hasFeature(name: string): boolean {
  return current.includes(name);
}
