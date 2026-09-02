import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { isMock } from '../../src/api/endpoints';
import { mockFlags } from '../../src/api/mock/adapter';
import { MOCK_DELIVERY_OTP, MOCK_PICKUP_OTP } from '../../src/api/mock/fixtures';
import { useSession } from '../../src/store/session';
import { stopTracking, trackedOrderId } from '../../src/location/tracking';
import { color, space } from '../../src/theme/tokens';
import { Hairline } from '../../src/ui/Hairline';
import { PrimaryButton } from '../../src/ui/PrimaryButton';
import { Screen } from '../../src/ui/Screen';
import { StatusBar } from '../../src/ui/StatusBar';
import { Text } from '../../src/ui/Text';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: space.md,
      }}
    >
      <Text variant="body" tone="soft">
        {label}
      </Text>
      <Text variant="bodyStrong" nums style={{ flexShrink: 1, textAlign: 'right' }}>
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
      <Text variant="body" style={{ flex: 1, paddingRight: space.lg }}>
        {label}
      </Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: color.brand }} />
    </View>
  );
}

export default function Profile() {
  const router = useRouter();
  const { rider, server, connected, disconnect } = useSession();

  const [steal, setSteal] = useState(mockFlags.stealNextOrder);
  const [offline, setOffline] = useState(mockFlags.offline);

  const mock = isMock();

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <StatusBar state={connected ? 'idle' : 'disconnected'} />

      <Screen>
        <Text variant="title">{rider?.name ?? 'Not connected'}</Text>
        <Text variant="body" tone="soft" style={{ marginTop: space.xs }}>
          {rider?.mobile}
        </Text>

        <Hairline />

        <Row label="Rider ID" value={rider ? String(rider.id) : '—'} />
        <Row label="Type" value={rider?.kind ?? '—'} />
        <Row label="Mode" value={mock ? 'Demo data' : 'Live server'} />
        {!mock ? (
          <>
            <Row label="Database" value={server?.db || '—'} />
            <Row
              label="Server"
              value={server?.url?.replace(/^https?:\/\//, '') || '—'}
            />
          </>
        ) : null}

        <PrimaryButton
          label="Change connection"
          kind="ghost"
          onPress={() => router.push('/connect')}
          style={{
            marginTop: space.lg,
            borderWidth: 1,
            borderColor: color.hairline,
          }}
        />

        {mock ? (
          <>
            <Hairline />
            <Text variant="label" tone="soft" upper>
              Demo controls
            </Text>
            <Text variant="body" tone="soft" style={{ marginTop: space.sm }}>
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

            <Text variant="body" tone="soft" nums style={{ marginTop: space.lg }}>
              Pickup code {MOCK_PICKUP_OTP} · delivery code {MOCK_DELIVERY_OTP}
            </Text>
          </>
        ) : null}

        <Hairline />

        <PrimaryButton
          label="Disconnect"
          kind="ghost"
          style={{ borderWidth: 1, borderColor: color.hairline }}
          onPress={async () => {
            // Never leave the location service running for a rider who has left.
            if (trackedOrderId() !== null) await stopTracking();
            await disconnect();
            router.replace('/connect');
          }}
        />
      </Screen>
    </View>
  );
}
