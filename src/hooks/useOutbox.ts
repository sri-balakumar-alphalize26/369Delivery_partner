import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { drainOutbox, hasPending, stepLabel } from '../api/outbox';
import { trackingWanted } from '../api/types';
import { startTracking, stopTracking, trackedOrderId } from '../location/tracking';

/** How often to try again while something waits and NetInfo has said nothing. */
const RETRY_MS = 20_000;

/**
 * Sends the outbox when there is a chance it will go: the signal coming back,
 * the app coming to the front, and every 20s while anything waits — NetInfo
 * says "connected" for a single bar that cannot carry a request, so its word
 * alone is not enough.
 *
 * Foreground only. Starting the location service for a step that turned on
 * tracking needs the app in front, and a step that fails is news the rider
 * should be looking at the screen for.
 */
export function useOutbox(connected: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!connected) return;

    const run = () => {
      if (AppState.currentState !== 'active' || !hasPending()) return;
      void drainOutbox(async ({ entry, result, refusal }) => {
        if (refusal) {
          Alert.alert(`Could not send "${stepLabel(entry.step)}"`, refusal.message);
        } else {
          // What the job screen does with a live answer, done here for the late one.
          if (result && (result.tracking !== undefined || !!result.status)) {
            if (trackingWanted(result.status, result.tracking)) await startTracking(entry.orderId);
            else if (trackedOrderId() === entry.orderId) await stopTracking();
          }
          if (entry.step === 'reached') {
            await AsyncStorage.setItem(`d369.reached.${entry.orderId}`, '1').catch(() => {});
          }
        }
        await qc.invalidateQueries();
      });
    };

    run();
    const net = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable ?? state.isConnected;
      if (reachable) run();
    });
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    const timer = setInterval(run, RETRY_MS);

    return () => {
      net();
      app.remove();
      clearInterval(timer);
    };
  }, [connected, qc]);
}
