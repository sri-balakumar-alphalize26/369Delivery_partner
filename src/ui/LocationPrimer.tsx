import { View } from 'react-native';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';
import { GlassCard } from './glass/GlassCard';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/**
 * Asks for location in words before Android asks for it in a dialog.
 *
 * The system prompt gives a rider two lines of text and two buttons, and on
 * Android a refusal is close to permanent — "Don't allow" twice and the app
 * cannot ask again. Firing it cold, at the moment they tap Start delivery, is
 * the worst time to ask: they are at a shop counter with a parcel in hand and
 * every reason to tap the button that makes the interruption go away.
 *
 * So this says what it is for first, and only then triggers the real prompt.
 * The pattern is taken from Enatega's rider app, which gives location its own
 * route for the same reason.
 *
 * It never replaces the system dialog and never claims permission of its own —
 * `onContinue` is what actually asks.
 */
export function LocationPrimer({
  onContinue,
  onSkip,
  busy,
}: {
  onContinue: () => void;
  onSkip?: () => void;
  busy?: boolean;
}) {
  return (
    <View style={{ padding: gspace.xl }}>
      <GlassCard>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: gradius.chip,
            backgroundColor: glass.fill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GlassIcon name="pin" color={glass.indigo} size={28} />
        </View>

        <GlassText variant="title" style={{ marginTop: gspace.lg }}>
          Share your location for this delivery
        </GlassText>

        <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
          The shop follows the parcel while you carry it, so the customer can be told
          where it is without calling you.
        </GlassText>

        <View style={{ marginTop: gspace.lg, gap: gspace.md }}>
          <Point text="It starts when you begin a delivery, never before." />
          <Point text="It stops the moment the parcel is handed over." />
          <Point text="Android needs “All the time” for it to keep working with the screen off." />
        </View>

        <GlassButton
          title="Continue"
          kind="dark"
          icon="check"
          onPress={onContinue}
          loading={busy}
          style={{ marginTop: gspace.xl }}
        />

        {onSkip ? (
          <GlassButton
            title="Not now"
            kind="ghost"
            onPress={onSkip}
            disabled={busy}
            style={{ marginTop: gspace.md }}
          />
        ) : null}
      </GlassCard>
    </View>
  );
}

function Point({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      <GlassIcon name="check" color={glass.green} size={16} />
      <GlassText variant="body" tone="soft" style={{ flex: 1, marginLeft: gspace.sm }}>
        {text}
      </GlassText>
    </View>
  );
}
