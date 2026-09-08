import { View } from 'react-native';
import { glass, gradius, gspace } from '../../theme/glass';
import { GlassButton } from './GlassButton';
import { GlassCard } from './GlassCard';
import { GlassIcon } from './GlassIcon';
import { GlassText } from './GlassText';

/**
 * Something went wrong, said once so four screens cannot each invent their own
 * wording for it.
 *
 * Two shapes, because the two cases are genuinely different to a rider:
 *
 * `blocking` is for a screen that has nothing to show — the first request
 * failed, there is no list, and the alternative is a screen saying "Nothing to
 * deliver" to a rider who has plenty of work waiting on the other side of a
 * dropped connection. That is the fault this component exists for.
 *
 * `quiet` is for a screen that already has jobs on it and has just failed to
 * refresh. The jobs stay. A rider mid-shift losing their list because one poll
 * out of a hundred timed out would be worse served than by the original fault,
 * so this only admits that the last attempt did not land.
 *
 * The message comes from the server wherever there is one. The contract is
 * explicit that `message` is written for riders to read and must not be
 * substituted with wording of our own.
 */
export function GlassProblem({
  message,
  onRetry,
  retrying,
  tone = 'blocking',
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  tone?: 'blocking' | 'quiet';
}) {
  if (tone === 'quiet') {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: glass.redSoft,
          borderRadius: gradius.chip,
          paddingVertical: gspace.sm,
          paddingHorizontal: gspace.md,
          marginTop: gspace.md,
        }}
      >
        <GlassIcon name="clock" color={glass.red} size={16} />
        <GlassText variant="caption" style={{ flex: 1, marginLeft: gspace.sm, color: glass.red }}>
          {message}
        </GlassText>
      </View>
    );
  }

  return (
    <GlassCard style={{ marginTop: gspace.md }}>
      <GlassText variant="subtitle">Cannot reach the server</GlassText>
      <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
        {message}
      </GlassText>

      {/* Deliberately not "Nothing to deliver". A rider reading that would go
          home, and there may be a shift's work on the other side of this. */}
      <GlassText variant="caption" tone="faint" style={{ marginTop: gspace.sm }}>
        This is the app failing to reach Odoo, not a shift with no work in it.
      </GlassText>

      {onRetry ? (
        <GlassButton
          title="Try again"
          kind="ghost"
          onPress={onRetry}
          loading={retrying}
          style={{ marginTop: gspace.lg }}
        />
      ) : null}
    </GlassCard>
  );
}
