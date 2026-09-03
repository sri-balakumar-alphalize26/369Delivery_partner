import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { glass, gradius, poppins } from '../../src/theme/glass';

/**
 * The Glass Light tab bar: icon over label, indigo when active.
 *
 * All four tabs the template draws, but two are honest about what the backend
 * lacks: Orders lists work in hand rather than history (a delivered job leaves
 * /orders), and Earnings says plainly that payouts are not set up.
 *
 * There is still no offer modal: the contract gives riders no way to decline a
 * job (`offered` allows only `accept`) and no expiry to count down, so an
 * interrupting popup would be theatre. New jobs surface on Home.
 */
export default function AppLayout() {
  // app.json sets edgeToEdgeEnabled, so the app draws underneath Android's
  // navigation bar. Without adding the inset the gesture bar sits on top of the
  // tabs and swallows taps on them.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: glass.indigo,
        tabBarInactiveTintColor: glass.inkFaint,
        tabBarStyle: {
          // Translucent over the mesh, as the template's floating glass pill.
          backgroundColor: glass.fillStrong,
          borderTopWidth: 1,
          borderTopColor: glass.border,
          elevation: 0,
          // Tall enough for icon + label with the label's full line box. At 68
          // the descenders were being clipped.
          height: 76 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarLabelStyle: {
          fontFamily: poppins.semibold,
          fontSize: 11,
          // Both of these matter on Android. A custom font carries extra
          // intrinsic padding, which in a tight tab bar clips the label; an
          // explicit lineHeight plus includeFontPadding:false gives the text a
          // box that fits what it actually draws.
          lineHeight: 15,
          includeFontPadding: false,
          letterSpacing: 0.2,
          paddingBottom: 2,
        },
        tabBarIconStyle: { marginTop: 2 },
        tabBarItemStyle: { borderRadius: gradius.chip, paddingVertical: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet-outline" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="order/[id]" options={{ href: null }} />
    </Tabs>
  );
}
