import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../store/session';

/**
 * Keep what the office switched on in Delivery Settings current on a phone
 * that is already open.
 *
 * `me` used to be asked only at launch and sign-in, so unticking "Riders Log
 * Fuel & Problems" left My vehicle on every running phone until it was
 * restarted. Now it is asked again when the app comes back to the front and
 * every two minutes while it is open — cheap, one small call.
 */
const EVERY_MS = 2 * 60_000;

export function useSettingsRefresh(connected: boolean): void {
  const refresh = useSession((s) => s.refresh);

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, EVERY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [connected, refresh]);
}

/** Ask again whenever this screen comes into view. */
export function useRefreshOnFocus(): void {
  const refresh = useSession((s) => s.refresh);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );
}
