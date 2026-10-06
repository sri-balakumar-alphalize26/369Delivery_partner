import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isMock } from '../../src/api/endpoints';
import { mockFlags } from '../../src/api/mock/adapter';
import { MOCK_DELIVERY_OTP, MOCK_PICKUP_OTP } from '../../src/api/mock/fixtures';
import { peekServer, SERVER_LOCKED } from '../../src/api/config';
import { clearOutbox } from '../../src/api/outbox';
import { confirm } from '../../src/ui/ConfirmSheet';
import { getNavApp, NAV_APPS, NavApp, setNavApp } from '../../src/lib/navigate';
import { stopDutyWatch, stopTracking, trackedOrderId } from '../../src/location/tracking';
import {
  currentPushToken,
  sendTestNotification,
  unregisterCurrentPush,
} from '../../src/push/register';
import { sortForRider, useOrders } from '../../src/hooks/useOrders';
import { useSession } from '../../src/store/session';
import { useRefreshOnFocus } from '../../src/hooks/useSettingsRefresh';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../src/theme/glass';
import { GlassButton } from '../../src/ui/glass/GlassButton';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';
import { EmergencyContactsCard } from '../../src/ui/EmergencyContactsCard';
import { GlassIcon, GlassIconName } from '../../src/ui/glass/GlassIcon';
import { useNow } from '../../src/hooks/useNow';
import { onDutyFor } from '../../src/lib/format';
import { kindLabel } from '../../src/lib/riderKind';
import { setupProgress } from '../../src/lib/phoneSetup';
import { getContacts } from '../../src/lib/emergencyContacts';

/**
 * The rider's account: who they are, today's numbers, and four big tiles for
 * what they come here for (phone setup, emergency contacts, navigation app,
 * calling the office). Server and build details fold away under "About this
 * app". Layout B of the five shown on the Profile canvas (6 Oct 2026).
 *
 * The template shows Hub, Vehicle, "Documents Verified" and a 4.8 rating, plus
 * Notification-sound and Language toggles. None of those exist: `Rider` carries
 * six fields, and there is no settings store or i18n — so they would be rows
 * that lie and controls that do nothing. What is here is what the contract
 * returns.
 */
export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { rider, server, connected, disconnect } = useSession();
  // The office may have switched fuel logs on or off since this phone opened.
  useRefreshOnFocus();
  // Only to give the test notification a real job to open.
  const { data: orders, isRefetching, refetch } = useOrders();

  const [steal, setSteal] = useState(mockFlags.stealNextOrder);
  const [offline, setOffline] = useState(mockFlags.offline);

  const [navApp, setNavAppState] = useState<NavApp>('google');
  useEffect(() => {
    getNavApp().then(setNavAppState);
  }, []);
  const chooseNavApp = (app: NavApp) => {
    setNavAppState(app);
    void setNavApp(app);
  };

  const mock = isMock();

  // Today's figures for the strip under the header.
  const now = useNow(60_000);
  const counts = orders?.counts;
  const onDutyTime = rider?.on_duty ? onDutyFor(rider.duty_since, now) : null;

  // The tiles' second lines, re-read whenever Profile comes into view.
  const [setup, setSetup] = useState<{ done: number; total: number } | null>(null);
  const [contactCount, setContactCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setupProgress().then(setSetup).catch(() => {});
      getContacts().then((c) => setContactCount(c.length)).catch(() => {});
    }, [])
  );
  const setupLeft = setup ? setup.total - setup.done : 0;

  const [contactsOpen, setContactsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const office = peekServer().supportPhone;
  const navLabel = NAV_APPS.find((a) => a.key === navApp)?.label ?? 'Google Maps';

  return (
    <GlassScreen>
      {/* Who is signed in: avatar, name and role, on the green band. */}
      <View
        style={{
          backgroundColor: glass.band,
          paddingTop: insets.top + gspace.lg,
          paddingBottom: 64,
          alignItems: 'center',
          paddingHorizontal: gspace.xl,
        }}
      >
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: glass.accent,
            borderWidth: 3,
            borderColor: glass.tabOn,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GlassText variant="hero" style={{ color: glass.accentInk }}>
            {initials(rider?.name)}
          </GlassText>
        </View>
        <GlassText variant="hero" tone="white" numberOfLines={1} style={{ marginTop: gspace.sm }}>
          {rider?.name ?? 'Not connected'}
        </GlassText>
        {rider ? (
          <View
            style={{
              marginTop: gspace.xs,
              paddingHorizontal: gspace.md,
              paddingVertical: 4,
              borderRadius: 12,
              backgroundColor: glass.tabOn,
            }}
          >
            <GlassText variant="label" upper style={{ color: glass.accentInk }}>
              {`${kindLabel(rider.kind)} · ID ${rider.id}`}
            </GlassText>
          </View>
        ) : null}
      </View>

      <ScrollView
        style={{ marginTop: -44 }}
        contentContainerStyle={{
          paddingHorizontal: gspace.lg,
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxl + insets.bottom,
          rowGap: gspace.md,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
      >
        {/* The day so far, the numbers riders look for first. */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: glass.white,
            borderRadius: gradius.card + 2,
            borderWidth: 1,
            borderColor: glass.divider,
            paddingVertical: gspace.lg,
          }}
        >
          <Stat value={String(counts?.delivered_today ?? 0)} label="today" />
          <Stat value={String(counts?.delivered_week ?? 0)} label="this week" divider />
          <Stat value={onDutyTime ?? (rider?.on_duty ? '—' : 'Off duty')} label="on duty today" />
        </View>

        {/* The four things a rider comes here for, one tap each. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gspace.md }}>
          <Tile
            icon="settings"
            title="Phone setup"
            detail={setup ? (setupLeft > 0 ? `${setupLeft} step${setupLeft === 1 ? '' : 's'} left` : 'All done') : ' '}
            warn={setupLeft > 0}
            onPress={() => router.push('/setup')}
          />
          <Tile
            icon="shield"
            iconColor="#C62828"
            title="Emergency contacts"
            detail={contactCount ? `${contactCount} saved` : 'None yet'}
            active={contactsOpen}
            onPress={() => setContactsOpen((v) => !v)}
          />
          <Tile
            icon="nav"
            title="Navigation"
            detail={`${navLabel} · tap to change`}
            onPress={() => chooseNavApp(navApp === 'google' ? 'waze' : 'google')}
          />
          <Tile
            icon="phone"
            title="Call the office"
            detail={office ? 'Help with a job' : 'No number set'}
            disabled={!office}
            onPress={() => void Linking.openURL(`tel:${office.replace(/[^\d+]/g, '')}`).catch(() => {})}
          />
        </View>

        {/* Opened from its tile, so the list stays short until it is wanted. */}
        {contactsOpen ? <EmergencyContactsCard /> : null}

        {/* What support asks for: server and build. Folded away from riders. */}
        <Pressable
          onPress={() => setAboutOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: aboutOpen }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: gspace.sm,
            padding: gspace.md,
            borderRadius: gradius.card,
            borderWidth: 1,
            borderColor: glass.divider,
            backgroundColor: pressed ? glass.fill : glass.white,
          })}
        >
          <GlassIcon name="alert" size={18} color={glass.inkSoft} />
          <GlassText variant="bodyStrong" style={{ flex: 1 }}>
            About this app
          </GlassText>
          <GlassText variant="caption" tone="soft" nums>
            {`v${Constants.expoConfig?.version ?? '—'}${!mock && server?.db ? ` · ${server.db}` : mock ? ' · Demo' : ''}`}
          </GlassText>
          <GlassIcon name={aboutOpen ? 'chevUp' : 'chevDown'} size={16} color={glass.inkSoft} />
        </Pressable>
        {aboutOpen ? (
          <GlassCard padding={gspace.sm}>
            <Row label="Rider ID" value={rider ? String(rider.id) : '—'} />
            <Row label="Phone" value={rider?.mobile || '—'} />
            <Row label="Type" value={kindLabel(rider?.kind)} />
            {/* Read-only here: Home owns the switch. */}
            <Row label="Duty" value={rider?.on_duty ? 'On duty' : 'Off duty'} />
            <Row label="Mode" value={mock ? 'Demo data' : 'Live server'} />
            {!mock ? (
              <>
                <Row label="Database" value={server?.db || '—'} />
                <Row label="Server" value={server?.url?.replace(/^https?:\/\//, '') || '—'} />
              </>
            ) : null}
            <Row label="App version" value={Constants.expoConfig?.version ?? '—'} last />
            {/* A locked build's server is not the rider's to change. */}
            {SERVER_LOCKED ? null : (
              <GlassButton
                title="Change connection"
                kind="ghost"
                icon="compass"
                onPress={() => router.push('/connect')}
                style={{ margin: gspace.sm }}
              />
            )}
          </GlassCard>
        ) : null}

        {mock ? (
          <GlassCard>
            <GlassText variant="label" tone="soft" upper>
              Demo controls
            </GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              No server is connected. Use these to test what happens when things go
              wrong.
            </GlassText>

            <Toggle
              label="Next job gets taken by another rider"
              value={steal}
              onChange={(v) => {
                mockFlags.stealNextOrder = v;
                setSteal(v);
              }}
            />
            <Toggle
              label="Simulate no internet"
              value={offline}
              onChange={(v) => {
                mockFlags.offline = v;
                setOffline(v);
              }}
            />

            <GlassText variant="caption" tone="soft" nums style={{ marginTop: gspace.lg }}>
              Pickup code {MOCK_PICKUP_OTP} · delivery code {MOCK_DELIVERY_OTP}
            </GlassText>
          </GlassCard>
        ) : null}

        {/* Development only — __DEV__ is false in a release build, so this
            cannot reach a rider. Deliberately NOT tied to demo mode: push has
            to be testable against a live server too. */}
        {__DEV__ ? (
          <GlassCard>
            <GlassText variant="label" tone="soft" upper>
              Push diagnostics
            </GlassText>
            <GlassText variant="caption" tone="soft" style={{ marginTop: gspace.sm }}>
              A local notification never touches Firebase, so this works over the
              Expo QR with no rebuild. It checks permission, the Android channel,
              the banner and tap-to-open — everything except delivery.
            </GlassText>

            <GlassButton
              title="Send test notification"
              kind="ghost"
              icon="bell"
              onPress={() => sendTestNotification(sortForRider(orders?.orders)[0]?.delivery_order_id)}
              style={{ marginTop: gspace.lg }}
            />

            <GlassText variant="caption" tone="faint" style={{ marginTop: gspace.md }}>
              {currentPushToken()
                ? `Token: ${currentPushToken()?.slice(0, 28)}…`
                : 'No push token yet — expected until the APK is rebuilt with google-services.json and Odoo exposes /push/register.'}
            </GlassText>
          </GlassCard>
        ) : null}

        {/* Last and apart from the tiles, so it is never pressed by mistake. */}
        <GlassButton
          title="Sign out"
          kind="danger"
          style={{ marginTop: gspace.md }}
          onPress={async () => {
            const ok = await confirm({
              title: 'Sign out?',
              message:
                'You stop getting jobs on this phone. Signing in again needs a new code on WhatsApp.',
              okLabel: 'Sign out',
            });
            if (!ok) return;
            // Never leave the location service running, or keep pushing jobs
            // to, a rider who has left. Both happen BEFORE disconnect, while
            // the session can still authenticate the calls.
            if (trackedOrderId() !== null) await stopTracking();
            await stopDutyWatch();
            await unregisterCurrentPush();
            // Steps still waiting for signal were this rider's, not the next one's.
            clearOutbox();
            await disconnect();
            router.replace('/connect');
          }}
        />

        {!connected ? (
          <GlassText variant="caption" tone="faint" style={{ textAlign: 'center' }}>
            Not connected to a server
          </GlassText>
        ) : null}
      </ScrollView>
    </GlassScreen>
  );
}

/** One figure in the strip: a big number over a small label. */
function Stat({ value, label, divider }: { value: string; label: string; divider?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: gspace.xs,
        borderLeftWidth: divider ? 1 : 0,
        borderRightWidth: divider ? 1 : 0,
        borderColor: glass.divider,
      }}
    >
      <GlassText variant="title" nums numberOfLines={1}>
        {value}
      </GlassText>
      <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
        {label}
      </GlassText>
    </View>
  );
}

/** One of the four big tiles: icon, title, a short status line. */
function Tile({
  icon,
  iconColor,
  title,
  detail,
  warn,
  active,
  disabled,
  onPress,
}: {
  icon: GlassIconName;
  iconColor?: string;
  title: string;
  detail: string;
  warn?: boolean;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      style={({ pressed }) => ({
        flexBasis: '47%',
        flexGrow: 1,
        minHeight: 108,
        padding: gspace.md,
        rowGap: gspace.sm,
        borderRadius: gradius.card + 2,
        borderWidth: active ? 2 : 1,
        borderColor: warn ? glass.orangeLine : active ? glass.accentLine : glass.divider,
        backgroundColor: pressed ? glass.fill : glass.white,
        opacity: disabled ? 0.55 : 1,
      })}
    >
      <GlassIcon name={icon} size={24} color={warn ? glass.orange : iconColor ?? glass.green} />
      <GlassText variant="bodyStrong">{title}</GlassText>
      <GlassText variant="caption" tone={warn ? 'orange' : 'soft'} style={warn ? { fontWeight: '700' } : undefined}>
        {detail}
      </GlassText>
    </Pressable>
  );
}

/** First letters of the first two words — "Arjun Menon" becomes "AM". */
function initials(name: string | undefined): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: gspace.md,
        paddingHorizontal: gspace.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: glass.divider,
      }}
    >
      <GlassText variant="body" tone="soft">
        {label}
      </GlassText>
      <GlassText variant="bodyStrong" nums style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </GlassText>
    </View>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: gspace.lg,
      }}
    >
      <GlassText variant="body" style={{ flex: 1, paddingRight: gspace.lg }}>
        {label}
      </GlassText>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: glass.green, false: glass.dividerDashed }}
        thumbColor={value ? glass.accent : glass.white}
      />
    </View>
  );
}
