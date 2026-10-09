import AsyncStorage from '@react-native-async-storage/async-storage';
import { WorkLine } from '../api/types';

/**
 * Which side of the app a hybrid agent had open last - Delivery or Service -
 * so the next launch opens there. Someone who works in one line only never
 * needs it: the office's "Works In" decides for them.
 *
 * Also whether the "You work in Delivery and Service" card has been shown.
 */

const KEY = 'd369.workspace';
const INTRO_KEY = 'd369.workspaceIntroSeen';

export async function getSavedWorkspace(): Promise<WorkLine | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === 'delivery' || v === 'service' ? v : null;
  } catch {
    return null;
  }
}

export async function saveWorkspace(ws: WorkLine): Promise<void> {
  await AsyncStorage.setItem(KEY, ws).catch(() => {});
}

export async function introSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(INTRO_KEY)) === '1';
  } catch {
    return true;
  }
}

export async function markIntroSeen(): Promise<void> {
  await AsyncStorage.setItem(INTRO_KEY, '1').catch(() => {});
}

/** The side to open: the saved one if this person still works in it, else their first line. */
export function pickWorkspace(lines: WorkLine[], saved: WorkLine | null): WorkLine {
  return saved && lines.includes(saved) ? saved : (lines[0] ?? 'delivery');
}
