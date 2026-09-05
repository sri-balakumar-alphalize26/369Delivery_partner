import { Ionicons } from '@expo/vector-icons';
import {
  Poppins_600SemiBold,
  useFonts,
} from '@expo-google-fonts/poppins';
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

  /**
   * Wait for Poppins before drawing the bar, and this is load-bearing rather
   * than tidiness.
   *
   * The root layout mounts the whole app tree on the first frame and hides it
   * behind the splash, so without this the tab bar measures its labels while
   * Poppins is still loading. Android measures them against the fallback face,
   * gets a width that does not match what it later draws, and — because the
   * label is numberOfLines={1} — ellipsizes "Earnings" to "Earnin…" and never
   * measures again. It looked fixed under fast refresh only because the font
   * was already loaded by then; every cold start still showed it.
   *
   * `useFonts` is shared and idempotent, so this resolves immediately once the
   * root's call has finished. Rendering nothing meanwhile costs nothing: the
   * splash is covering this.
   */
  const [fontsLoaded, fontError] = useFonts({ Poppins_600SemiBold });
  if (!fontsLoaded && !fontError) return null;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: glass.indigo,
        tabBarInactiveTintColor: glass.inkFaint,
        // React Navigation picks the label position itself, and on a screen
        // 768dp or wider — this tablet is ~800dp — it puts the label in a row
        // beside the icon instead. The label then gets only the width the icon
        // leaves it, and Android ellipsizes it to "Ho…". Pin it: the
        // icon-over-label stack described above is also the one that gives each
        // label the full width of its tab.
        tabBarLabelPosition: 'below-icon',
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
          // Nothing else. The label is numberOfLines={1}, and every tab has
          // flex:1 — about 300dp on this tablet — so there is ample room for
          // "Earnings". It was still ellipsizing to "Earnin…", because on
          // Android an explicit lineHeight and letterSpacing on a custom font
          // make the text measure wider than it draws. Left to itself it fits.
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
