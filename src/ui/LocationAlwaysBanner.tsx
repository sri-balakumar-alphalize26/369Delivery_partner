import { useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { hasLocationPermission } from '../location/tracking';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/**
 * A warning on a job whose location is not set to "Allow all the time".
 *
 * With only "While using the app", the phone stops sending positions once the
 * screen is off. The server then cannot mark the rider near the customer by
 * itself (no "rider is near" WhatsApp), and the office loses them on its map.
 * Nothing failed loudly before: the job just went quiet.
 *
 * Checked again whenever the app comes back to the front, so it goes away as
 * soon as the rider has changed the setting. Expo Go cannot grant background
 * location at all, and `hasLocationPermission` answers yes there, so it never
 * shows in a development client.
 */
export function LocationAlwaysBanner() {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    const check = () =>
      hasLocationPermission()
        .then((ok) => live && setMissing(!ok))
        .catch(() => {});
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  if (!missing) return null;

  return (
    <View
      accessibilityRole="alert"
      style={{
        marginTop: gspace.lg,
        padding: gspace.lg,
        borderRadius: gradius.card,
        borderWidth: 1,
        borderColor: glass.orangeLine,
        backgroundColor: glass.orangeSoft,
        rowGap: gspace.sm,
      }}
    >
      <View style={{ flexDirection: 'row', columnGap: gspace.sm, alignItems: 'flex-start' }}>
        <GlassIcon name="pin" size={20} color={glass.orange} />
        <View style={{ flex: 1 }}>
          <GlassText variant="bodyStrong" style={{ color: glass.orange }}>
            Location is not set to &ldquo;Allow all the time&rdquo;
          </GlassText>
          <GlassText variant="body" tone="soft" style={{ marginTop: 2 }}>
            The customer won&rsquo;t get the &ldquo;rider is near&rdquo; message, and the office
            can&rsquo;t see you when the screen is off.
          </GlassText>
        </View>
      </View>
      <GlassButton
        title="Open settings"
        kind="ghost"
        icon="settings"
        onPress={() => void Linking.openSettings()}
      />
    </View>
  );
}
