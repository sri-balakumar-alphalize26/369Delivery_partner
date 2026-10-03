import { Ionicons } from '@expo/vector-icons';
import {
  Manrope_700Bold,
  useFonts,
} from '@expo-google-fonts/manrope';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, glass, gradius } from '../../src/theme/glass';

/**
 * The tab bar: a deep green band, icon over label, lime when active.
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
   * Wait for the label's face before drawing the bar, and this is load-bearing
   * rather than tidiness.
   *
   * The root layout mounts the whole app tree on the first frame and hides it
   * behind the splash, so without this the tab bar measures its labels while
   * the font is still loading. Android measures them against the fallback face,
   * gets a width that does not match what it later draws, and — because the
   * label is numberOfLines={1} — ellipsizes "Earnings" to "Earnin…" and never
   * measures again. It looked fixed under fast refresh only because the font
   * was already loaded by then; every cold start still showed it.
   *
   * `useFonts` is shared and idempotent, so this resolves immediately once the
   * root's call has finished. Rendering nothing meanwhile costs nothing: the
   * splash is covering this.
   */
  // The face `font.semibold` names, which is what the label below is set in.
  const [fontsLoaded, fontError] = useFonts({ Manrope_700Bold });
  if (!fontsLoaded && !fontError) return null;

  return (
    <Tabs
      // Back goes to the tab the rider came from. The default, `firstRoute`,
      // sent Android's back from a job or a past job straight to Home.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: glass.tabOn,
        tabBarInactiveTintColor: glass.tabOff,
        // React Navigation picks the label position itself, and on a screen
        // 768dp or wider — this tablet is ~800dp — it puts the label in a row
        // beside the icon instead. The label then gets only the width the icon
        // leaves it, and Android ellipsizes it to "Ho…". Pin it: the
        // icon-over-label stack described above is also the one that gives each
        // label the full width of its tab.
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: {
          // A solid band, the same green as the headers: it frames the screen
          // top and bottom, and needs no hairline to separate it.
          backgroundColor: glass.band,
          borderTopWidth: 0,
          elevation: 0,
          // Tall enough for icon + label with the label's full line box. At 68
          // the descenders were being clipped.
          height: 76 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarLabelStyle: {
          fontFamily: font.semibold,
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
      {/* href: null only hides it FROM the bar. A job — above all an offer that
          has just taken over the screen — should own the whole screen rather
          than sit above four tabs inviting the rider away mid-handover. */}
      {/* Reached from Profile, not the bar. */}
      <Tabs.Screen name="vehicle" options={{ href: null }} />
      <Tabs.Screen
        name="order/[id]"
        options={{ href: null, tabBarStyle: { display: 'none' } }}
      />
      {/* A finished job, opened from Orders → Past. Read-only. */}
      <Tabs.Screen
        name="past/[id]"
        options={{ href: null, tabBarStyle: { display: 'none' } }}
      />
    </Tabs>
  );
}
