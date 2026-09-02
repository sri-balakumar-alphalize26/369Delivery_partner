import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Storage for the access token and server settings.
 *
 * On a phone this is the OS keystore, which is where a credential belongs.
 * `expo-secure-store` has no web implementation at all, so the browser — used
 * only for previewing the UI during development — falls back to localStorage.
 * That is not secure storage, and is fine because nobody delivers parcels from
 * a browser.
 */

const isWeb = Platform.OS === 'web';

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* private mode or blocked storage — the preview still works */
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.deleteItemAsync(key).catch(() => {});
}
