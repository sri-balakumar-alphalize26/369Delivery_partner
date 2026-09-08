import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Whether the phone has a usable connection.
 *
 * `@react-native-community/netinfo` has been a dependency all along and was
 * never called, so the app could not tell a rider the difference between "your
 * phone is offline" and "the server is not answering". Those have different
 * remedies — one is a tunnel or a dead lorry of a laptop, the other is a lift
 * doorway — and a rider who cannot tell them apart restarts an app that was
 * never at fault.
 *
 * `isInternetReachable` rather than `isConnected`: Android reports a captive
 * portal or a wifi network with no route out as connected, which is exactly the
 * case a rider hits in a mall car park. It is null until the first probe
 * resolves, and null is treated as online — assuming the worst before there is
 * evidence would flash a warning on every cold start.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const stop = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable;
      setOnline(reachable === null ? !!state.isConnected : reachable);
    });
    return stop;
  }, []);

  return online;
}
