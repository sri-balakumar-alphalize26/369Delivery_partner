import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { retryDutyWatch, useDutyWatchProblem } from '../location/useDutyWatch';
import { glass, gspace } from '../theme/glass';
import { GlassText } from './glass/GlassText';

/**
 * One line in the duty card: whether a new job will ring with the phone locked,
 * and the one tap that fixes it when it will not.
 *
 * Drawn the way `SharingRow` is, directly above it, so the duty card reads as
 * a short list of "what the phone is doing for you" rather than as warnings.
 */

const BATTERY_KEY = 'd369.batteryAsked';

export function DutyWatchRow() {
  const problem = useDutyWatchProblem();
  const [fixing, setFixing] = useState(false);
  const [batteryAsked, setBatteryAsked] = useState(true);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    AsyncStorage.getItem(BATTERY_KEY)
      .then((v) => setBatteryAsked(v === '1'))
      .catch(() => {});
  }, []);

  // Expo Go, the web: nothing the rider can do about it, so nothing to say.
  if (problem === 'unsupported') return null;

  /**
   * The permission first, in Android's own dialog. If Android will no longer
   * ask — the rider refused twice — Settings is the only way left, so go there
   * rather than tap a button that does nothing.
   */
  async function fix() {
    setFixing(true);
    try {
      if (problem === 'services_off') {
        await Location.enableNetworkProviderAsync().catch(() => {});
      } else if (problem === 'foreground_denied') {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted && !perm.canAskAgain) await Linking.openSettings();
      }
      await retryDutyWatch();
    } finally {
      setFixing(false);
    }
  }

  /**
   * Phones that "optimise" battery (most Xiaomi, Oppo, Samsung and Huawei
   * builds) stop a foreground service anyway after a while. Android forbids
   * asking for the exemption directly without a Play review, so this opens the
   * list where the rider can set the app to "Don't optimise" — once, then it
   * stays out of the way.
   */
  async function openBattery() {
    await AsyncStorage.setItem(BATTERY_KEY, '1').catch(() => {});
    setBatteryAsked(true);
    await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() =>
      Linking.openSettings()
    );
  }

  if (problem) {
    const text =
      problem === 'services_off'
        ? 'Location is off · new jobs only ring while the app is open'
        : 'New jobs only ring while the app is open';
    const action = problem === 'services_off' ? 'Turn on' : 'Allow';
    return (
      <Row
        dot={glass.orange}
        text={text}
        action={fixing ? '…' : action}
        onPress={fix}
        disabled={fixing}
      />
    );
  }

  if (!batteryAsked) {
    return (
      <Row
        dot={glass.orange}
        text="Keep the app running so new jobs ring with the phone locked"
        action="Set up"
        onPress={openBattery}
      />
    );
  }

  return <Row dot={glass.green} text="New jobs ring with the phone locked" soft />;
}

function Row({
  dot,
  text,
  action,
  onPress,
  disabled,
  soft,
}: {
  dot: string;
  text: string;
  action?: string;
  onPress?: () => void;
  disabled?: boolean;
  soft?: boolean;
}) {
  const style = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: gspace.md,
    paddingTop: gspace.md,
    borderTopWidth: 1,
    borderTopColor: glass.divider,
  };
  const body = (
    <>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: dot,
          marginLeft: 6,
          marginRight: gspace.sm + 4,
        }}
      />
      <GlassText variant="body" tone={soft ? 'soft' : 'ink'} style={{ flex: 1 }} numberOfLines={2}>
        {text}
      </GlassText>
      {action ? (
        <GlassText variant="caption" tone="indigo">
          {action}
        </GlassText>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={style} accessibilityLabel={text}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${text}. ${action}.`}
      hitSlop={6}
      style={({ pressed }) => ({ ...style, opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}
