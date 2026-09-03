import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isMock } from '../../src/api/endpoints';
import { mockFlags } from '../../src/api/mock/adapter';
import { MOCK_DELIVERY_OTP, MOCK_PICKUP_OTP } from '../../src/api/mock/fixtures';
import { stopTracking, trackedOrderId } from '../../src/location/tracking';
import { useSession } from '../../src/store/session';
import { cardColor, space } from '../../src/theme/tokens';
import { Avatar } from '../../src/ui/Avatar';
import { Card } from '../../src/ui/Card';
import { GradientHeader } from '../../src/ui/GradientHeader';
import { Text } from '../../src/ui/Text';

/**
 * The rider's account, in the Bold Cards style.
 *
 * The reference shows Hub, Vehicle, "Documents Verified" and a 4.8 rating, plus
 * Notification-sound and Language toggles. None of those exist: `Rider` carries
 * six fields and there is no settings store or i18n, so they would be rows that
 * lie and controls that do nothing. What is here is what the contract returns.
 */

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: space.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: cardColor.divider,
      }}
    >
      <Text variant="cardBody" style={{ color: cardColor.textSecondary }}>
        {label}
      </Text>
      <Text
        variant="cardBody"
        nums
        style={{ color: cardColor.textPrimary, flexShrink: 1, textAlign: 'right' }}
      >
        {value}
      </Text>
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
        marginTop: space.lg,
      }}
    >
      <Text
        variant="cardBody"
        style={{ flex: 1, paddingRight: space.lg, color: cardColor.textPrimary }}
      >
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: cardColor.brand }}
      />
    </View>
  );
}

/** A quiet full-width action, as the reference draws Support / Sign out. */
function LinkRow({
  label,
  tone,
  onPress,
}: {
  label: string;
  tone?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingVertical: space.lg,
        alignItems: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text variant="cardButton" style={{ color: tone ?? cardColor.brand }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { rider, server, connected, disconnect } = useSession();

  const [steal, setSteal] = useState(mockFlags.stealNextOrder);
  const [offline, setOffline] = useState(mockFlags.offline);

  const mock = isMock();

  return (
    <View style={{ flex: 1, backgroundColor: cardColor.canvas }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.huge + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <GradientHeader
          style={{
            paddingTop: insets.top + space.lg,
            paddingHorizontal: space.xl,
            paddingBottom: space.xxl,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Avatar name={rider?.name} />
          <View style={{ marginLeft: space.md, flex: 1 }}>
            <Text
              variant="cardTitle"
              style={{ color: cardColor.card }}
              numberOfLines={1}
            >
              {rider?.name ?? 'Not connected'}
            </Text>
            {rider?.mobile ? (
              <Text
                variant="cardBody"
                style={{ color: 'rgba(255,255,255,0.72)', marginTop: 2 }}
              >
                {rider.mobile}
              </Text>
            ) : null}
          </View>
        </GradientHeader>

        <View style={{ paddingHorizontal: space.xl, marginTop: space.xl }}>
          <Card style={{ paddingVertical: space.sm }}>
            <Row label="Rider ID" value={rider ? String(rider.id) : '—'} />
            <Row label="Type" value={rider?.kind ?? '—'} />
            {/* Read-only here — Home owns the control, so there is one source of
                truth for a state the server holds anyway. */}
            <Row label="Duty" value={rider?.on_duty ? 'On duty' : 'Off duty'} />
            <Row
              label="Mode"
              value={mock ? 'Demo data' : 'Live server'}
              last={mock}
            />
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
          </Card>

          {mock ? (
            <Card style={{ marginTop: space.lg }}>
              <Text variant="cardLabel" upper style={{ color: cardColor.textSecondary }}>
                Demo controls
              </Text>
              <Text
                variant="cardBody"
                style={{ color: cardColor.textSecondary, marginTop: space.sm }}
              >
                No server is connected. Use these to test what happens when things go
                wrong.
              </Text>

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

              <Text
                variant="cardCaption"
                nums
                style={{ color: cardColor.textSecondary, marginTop: space.lg }}
              >
                Pickup code {MOCK_PICKUP_OTP} · delivery code {MOCK_DELIVERY_OTP}
              </Text>
            </Card>
          ) : null}

          <View style={{ marginTop: space.xl }}>
            <LinkRow label="Change connection" onPress={() => router.push('/connect')} />
            <LinkRow
              label="Sign out"
              tone={cardColor.red}
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
            <Text
              variant="cardCaption"
              style={{
                color: cardColor.textFaint,
                textAlign: 'center',
                marginTop: space.md,
              }}
            >
              Not connected to a server
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
