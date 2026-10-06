import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { openFor, setupProgress } from '../lib/phoneSetup';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/** Re-run `check` now and whenever the app comes back to the front. */
function useOnFront(check: () => void): void {
  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Notifications switched off: a red warning on Home. New jobs ring as
 * notifications, so with them off the app can only find jobs by checking every
 * few seconds, and the rider hears nothing.
 */
export function NotificationsOffBanner() {
  const [off, setOff] = useState(false);
  useOnFront(() => {
    Notifications.getPermissionsAsync()
      .then((p) => setOff(!p.granted))
      .catch(() => {});
  });
  if (!off) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: gspace.lg,
        borderRadius: gradius.card,
        borderWidth: 1,
        borderColor: glass.red,
        backgroundColor: glass.redSoft,
        rowGap: gspace.sm,
      }}
    >
      <View style={{ flexDirection: 'row', columnGap: gspace.sm }}>
        <GlassIcon name="bell" size={20} color={glass.red} />
        <View style={{ flex: 1 }}>
          <GlassText variant="bodyStrong" tone="red">
            Notifications are off
          </GlassText>
          <GlassText variant="body" tone="soft" style={{ marginTop: 2 }}>
            New jobs will not ring. You can miss them.
          </GlassText>
        </View>
      </View>
      <GlassButton
        title="Turn on notifications"
        kind="ghost"
        icon="settings"
        // Straight to the notification switch, as the checklist row does.
        onPress={() => void openFor('notifications')}
      />
    </View>
  );
}

/**
 * "Finish setting up your phone · 3 of 6 done", on Home until every row of the
 * checklist is done. A tap opens the checklist.
 */
export function PhoneSetupCard() {
  const router = useRouter();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  useOnFront(() => {
    setupProgress()
      .then(setProgress)
      .catch(() => {});
  });
  if (!progress || progress.total === 0 || progress.done >= progress.total) return null;
  return (
    <Pressable
      onPress={() => router.push('/setup')}
      accessibilityRole="button"
      accessibilityLabel={`Finish setting up your phone, ${progress.done} of ${progress.total} done`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: gspace.md,
        padding: gspace.lg,
        borderRadius: gradius.card,
        borderWidth: 1,
        borderColor: glass.orangeLine,
        backgroundColor: pressed ? glass.orangeSoft : glass.white,
      })}
    >
      <GlassIcon name="settings" size={22} color={glass.orange} />
      <View style={{ flex: 1 }}>
        <GlassText variant="bodyStrong">Finish setting up your phone</GlassText>
        <GlassText variant="caption" tone="soft" nums style={{ marginTop: 2 }}>
          {`${progress.done} of ${progress.total} done · so no job is missed`}
        </GlassText>
      </View>
      <GlassIcon name="chev" size={18} color={glass.inkSoft} />
    </Pressable>
  );
}
