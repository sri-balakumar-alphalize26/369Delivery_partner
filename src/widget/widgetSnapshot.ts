import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * What the home-screen widget shows, saved by the app whenever it changes, so
 * the widget can draw itself with the app closed (widgetTask.ts).
 */
export interface WidgetSnapshot {
  onDuty: boolean;
  deliveredToday: number;
  /** "S00042 → Fatma", or null with no job in hand. */
  now: string | null;
  /** When it was saved, for "updated 17:40". */
  savedAt: number;
}

const KEY = 'd369.widget';

export async function loadSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WidgetSnapshot) : null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(s: WidgetSnapshot): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
}
