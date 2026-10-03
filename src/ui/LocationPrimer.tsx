import { View } from 'react-native';
import { useSession } from '../store/session';
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
 *
 * Two purposes. `delivery` is the original, at Start delivery. `duty` is asked
 * on clocking on, on a server with `delivery_fleet_ops`, whose live map shows
 * the office where riders on duty are. On such a server the delivery version
 * must not promise that nothing is shared before a delivery begins, so its
 * points follow the session rather than a flag at every call site.
 */
export function LocationPrimer({
  onContinue,
  onSkip,
  busy,
  purpose = 'delivery',
}: {
  onContinue: () => void;
  onSkip?: () => void;
  busy?: boolean;
  purpose?: 'delivery' | 'duty';
}) {
  const sharesOnDuty = useSession(
    (s) => s.features.includes('location') || !!s.fleet?.features.includes('location')
  );
  const fromAccept = useSession(
    (s) =>
      s.features.includes('track_from_accept') || !!s.fleet?.features.includes('track_from_accept')
  );

  const copy =
    purpose === 'duty'
      ? {
          title: 'Share your location while on duty',
          body: 'The office sees where riders are, so the next job can go to whoever is closest.',
          points: [
            'Only while you are on duty and the app is open.',
            'It stops when you go off duty.',
            'During a delivery the customer can follow the parcel, as before.',
          ],
        }
      : {
          title: 'Share your location for this delivery',
          body: fromAccept
            ? 'The customer follows you from the moment you accept — to the shop, then to their door — so they know when to expect you.'
            : 'The shop follows the parcel while you carry it, so the customer can be told where it is without calling you.',
          points: [
            fromAccept
              ? 'It starts when you accept a job.'
              : sharesOnDuty
                ? 'While you are on duty with the app open, the office also sees where you are.'
                : 'It starts when you begin a delivery, never before.',
            'It stops the moment the parcel is handed over.',
            'Android needs “All the time” for it to keep working with the screen off.',
          ],
        };

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
          {copy.title}
        </GlassText>

        <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
          {copy.body}
        </GlassText>

        <View style={{ marginTop: gspace.lg, gap: gspace.md }}>
          {copy.points.map((text) => (
            <Point key={text} text={text} />
          ))}
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
