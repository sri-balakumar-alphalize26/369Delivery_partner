import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cardColor, cardRadius, fontOutfit } from '../../src/theme/tokens';

/**
 * The Bold Cards tab bar: icon over label, brand blue when active.
 *
 * The reference template draws four tabs — Home, Orders, Earnings, Profile —
 * but Orders and Earnings have neither a screen nor an endpoint behind them
 * (there is no history or payout API), so only the two that exist are shown. A
 * tab that opens nothing is worse than a tab that is absent.
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
        tabBarActiveTintColor: cardColor.brand,
        tabBarInactiveTintColor: cardColor.textFaint,
        tabBarStyle: {
          backgroundColor: cardColor.card,
          borderTopWidth: 1,
          borderTopColor: cardColor.divider,
          elevation: 0,
          height: 68 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarLabelStyle: {
          fontFamily: fontOutfit.bold,
          fontSize: 12,
          letterSpacing: 0.2,
        },
        tabBarItemStyle: { borderRadius: cardRadius.chip },
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
