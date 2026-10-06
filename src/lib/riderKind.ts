import AsyncStorage from '@react-native-async-storage/async-storage';
import { RiderKind } from '../api/types';

/**
 * Office rider or Delivery Partner, as picked on the sign-in screen.
 *
 * Kept on the phone so the next sign-in opens with the same card chosen. In
 * demo mode it also decides which kind the demo rider is.
 */

export const RIDER_KINDS: { key: RiderKind; label: string; detail: string }[] = [
  { key: 'own', label: 'Office rider', detail: 'Staff of the shop, on salary' },
  { key: 'third_party', label: 'Delivery Partner', detail: 'Paid per delivery' },
];

export function kindLabel(kind: string | null | undefined): string {
  return RIDER_KINDS.find((k) => k.key === kind)?.label ?? 'Office rider';
}

const KEY = 'd369.riderKind';
let cached: RiderKind | null | undefined;

/** The last choice, or null before one has ever been made. */
export async function getRiderKind(): Promise<RiderKind | null> {
  if (cached !== undefined) return cached;
  try {
    const saved = await AsyncStorage.getItem(KEY);
    cached = saved === 'own' || saved === 'third_party' ? saved : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function setRiderKind(kind: RiderKind): Promise<void> {
  cached = kind;
  await AsyncStorage.setItem(KEY, kind).catch(() => {});
}
