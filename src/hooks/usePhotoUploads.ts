import NetInfo from '@react-native-community/netinfo';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { onOwedChange } from '../photos/owed';
import { drainPhotos } from '../photos/uploader';

/** How often to try again while photos wait and NetInfo has said nothing. */
const RETRY_MS = 20_000;

/**
 * Sends the parcel photos after Send: at once, when the signal comes back,
 * when the app comes to the front, and every 20 s while any wait - NetInfo
 * says "connected" for a single bar that cannot carry a photo.
 *
 * Not only in the foreground, unlike the outbox: the upload notification keeps
 * the app running with the phone in a pocket, and that is when it matters.
 */
export function usePhotoUploads(connected: boolean): void {
  useEffect(() => {
    if (!connected) return;

    const run = () => void drainPhotos();

    run();
    const owed = onOwedChange(run);
    const net = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable ?? state.isConnected;
      if (reachable) run();
    });
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    const timer = setInterval(run, RETRY_MS);

    return () => {
      owed();
      net();
      app.remove();
      clearInterval(timer);
    };
  }, [connected]);
}
