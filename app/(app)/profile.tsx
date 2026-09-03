import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isMock } from '../../src/api/endpoints';
import { mockFlags } from '../../src/api/mock/adapter';
import { MOCK_DELIVERY_OTP, MOCK_PICKUP_OTP } from '../../src/api/mock/fixtures';
import { stopTracking, trackedOrderId } from '../../src/location/tracking';
import { useSession } from '../../src/store/session';
import { glass, gradius, gspace } from '../../src/theme/glass';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';

/**
 * The rider's account, in the Glass Light style.
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

  const [steal, setSteal] = useState(mockFlags.stealNextOrder);
  const [offline, setOffline] = useState(mockFlags.offline);

  const mock = isMock();

  return (
    <GlassScreen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + gspace.xl,
          paddingHorizontal: gspace.xl,
          paddingBottom: gspace.xxxl + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: gradius.avatar,
              backgroundColor: glass.orange,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <GlassText variant="title" tone="white">
              {initials(rider?.name)}
            </GlassText>
          </View>
          <View style={{ marginLeft: gspace.md, flex: 1 }}>
            <GlassText variant="title" numberOfLines={1}>
              {rider?.name ?? 'Not connected'}
            </GlassText>
            {rider?.mobile ? (
              <GlassText variant="body" tone="soft">
                {rider.mobile}
              </GlassText>
            ) : null}
          </View>
        </View>

        <GlassCard style={{ marginTop: gspace.xl }} padding={gspace.sm}>
          <Row label="Rider ID" value={rider ? String(rider.id) : '—'} />
          <Row label="Type" value={rider?.kind ?? '—'} />
          {/* Read-only here — Home owns the control, so there is one source of
              truth for a state the server holds anyway. */}
          <Row label="Duty" value={rider?.on_duty ? 'On duty' : 'Off duty'} />
          <Row label="Mode" value={mock ? 'Demo data' : 'Live server'} last={mock} />
          {!mock ? (
            <>
              <Row label="Database" value={server?.db || '—'} />
              <Row
                label="Server"
                value={server?.url?.replace(/^https?:\/\//, '') || '—'}
                last
              />
            </>
          ) : null}
        </GlassCard>

        {mock ? (
          <GlassCard style={{ marginTop: gspace.lg }}>
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

        <View style={{ marginTop: gspace.xl }}>
          <LinkRow label="Change connection" onPress={() => router.push('/connect')} />
          <LinkRow
            label="Sign out"
            tone="red"
            onPress={async () => {
              // Never leave the location service running for a rider who has
              // left. This ordering is deliberate: stop first, then disconnect.
              if (trackedOrderId() !== null) await stopTracking();
              await disconnect();
              router.replace('/connect');
            }}
          />
        </View>

        {!connected ? (
          <GlassText
            variant="caption"
            tone="faint"
            style={{ textAlign: 'center', marginTop: gspace.md }}
          >
            Not connected to a server
          </GlassText>
        ) : null}
      </ScrollView>
    </GlassScreen>
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
      <Switch value={value} onValueChange={onChange} trackColor={{ true: glass.indigo }} />
    </View>
  );
}

function LinkRow({
  label,
  tone = 'indigo',
  onPress,
}: {
  label: string;
  tone?: 'indigo' | 'red';
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingVertical: gspace.lg,
        alignItems: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <GlassText variant="button" tone={tone}>
        {label}
      </GlassText>
    </Pressable>
  );
}
