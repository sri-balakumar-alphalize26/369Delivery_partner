import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useNow } from '../hooks/useNow';
import { fixSharing, SharingStatus, useSharingStatus } from '../location/dutyLocation';
import { glass, gspace } from '../theme/glass';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/**
 * Whether the office can see this rider, on the duty card.
 *
 * The live map shows a rider grey when their phone has gone quiet, but the
 * rider had no way to know it had — the test tablet sat with location off and
 * looked perfectly normal. This says it in one line, and when something is
 * wrong, offers the one tap that fixes it.
 */
export function SharingRow() {
  const status = useSharingStatus((s) => s.status);
  const [fixing, setFixing] = useState(false);
  // Re-render so "sent 1 min ago" keeps counting.
  useNow(15_000);

  const view = describe(status);
  if (!view) return null;

  const fix = view.action
    ? async () => {
        setFixing(true);
        try {
          await fixSharing(status);
        } finally {
          setFixing(false);
        }
      }
    : undefined;

  const body = (
    <>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: view.ok ? glass.green : glass.orange,
          marginLeft: 6,
          marginRight: gspace.sm + 4,
        }}
      />
      <GlassText
        variant="body"
        tone={view.ok ? 'soft' : 'ink'}
        style={{ flex: 1 }}
        numberOfLines={2}
      >
        {view.text}
      </GlassText>
      {view.action ? (
        <GlassText variant="caption" tone="indigo">
          {fixing ? '…' : view.action}
        </GlassText>
      ) : null}
    </>
  );

  const style = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: gspace.md,
    paddingTop: gspace.md,
    borderTopWidth: 1,
    borderTopColor: glass.divider,
  };

  if (!fix) {
    return (
      <View style={style} accessibilityLabel={view.text}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={fix}
      disabled={fixing}
      accessibilityRole="button"
      accessibilityLabel={`${view.text}. ${view.action}.`}
      hitSlop={6}
      style={({ pressed }) => ({ ...style, opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}

function describe(
  status: SharingStatus
): { text: string; ok: boolean; action?: string } | null {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'sharing':
      return { text: `Office can see you · updated ${ago(status.sentAt)}`, ok: true };
    case 'delivery':
      return { text: 'Office can see you · sharing for this delivery', ok: true };
    case 'locating':
      return { text: 'Finding your location…', ok: true };
    case 'no_fix':
      return {
        text: 'No location yet — the office cannot see you',
        ok: false,
        action: Platform.OS === 'android' ? 'Improve accuracy' : undefined,
      };
    case 'services_off':
      return { text: 'Location is off — the office cannot see you', ok: false, action: 'Turn on' };
    case 'no_permission':
      return {
        text: 'Location not allowed — the office cannot see you',
        ok: false,
        action: status.canAsk ? 'Allow' : 'Settings',
      };
    case 'failed':
      return {
        text: status.sentAt
          ? `Could not update · last sent ${ago(status.sentAt)}`
          : 'Could not reach the server · retrying',
        ok: false,
      };
  }
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  return m === 1 ? '1 min ago' : `${m} min ago`;
}
