import { Tabs } from 'expo-router';
import { color, font, space } from '../../src/theme/tokens';

/**
 * Label-only tab bar — no icons. Icons would be chrome, and this design has
 * none.
 *
 * There is no offer modal any more: the contract gives riders no way to decline
 * a job (`offered` allows only `accept`) and no expiry to count down, so an
 * interrupting popup would be theatre. New jobs surface on the Duty screen.
 */
export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.ink,
        tabBarInactiveTintColor: color.inkSoft,
        tabBarStyle: {
          backgroundColor: color.bg,
          borderTopWidth: 1,
          borderTopColor: color.hairline,
          elevation: 0,
          height: 64,
          paddingTop: space.sm,
        },
        tabBarLabelStyle: {
          fontFamily: font.semibold,
          fontSize: 11,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Jobs' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="order/[id]" options={{ href: null }} />
    </Tabs>
  );
}
