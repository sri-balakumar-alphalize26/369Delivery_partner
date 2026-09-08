import { View } from 'react-native';
import { DeliveryOrder, DeliveryStatus } from '../../api/types';
import { timeOnly } from '../../lib/format';
import { glass, gspace } from '../../theme/glass';
import { GlassText } from './GlassText';

/**
 * How far through the job the rider is, with the real times.
 *
 * `timestamps` has shipped on GET /orders/{id} since N2 and the app ignored
 * every field of it, so a rider mid-delivery had no way to see what they had
 * already done — the one thing a progress view is for.
 *
 * Every time here comes from the server. Nothing is inferred and nothing is
 * guessed from the clock: an empty string means "not yet", exactly as the
 * contract documents, and an absent step simply shows no time.
 */

/**
 * Four steps, not six.
 *
 * `offered` is not a step a rider took, and `dispatched` and
 * `out_for_delivery` are one thing from the road — the parcel left the shop
 * and is moving. Six dots on a phone would be legible only in theory.
 */
const STEPS: { key: keyof NonNullable<DeliveryOrder['timestamps']>; label: string }[] = [
  { key: 'accepted', label: 'Accepted' },
  { key: 'picked_up', label: 'Collected' },
  { key: 'out_for_delivery', label: 'On the road' },
  { key: 'delivered', label: 'Delivered' },
];

/**
 * Dot sizes, named because the rail's alignment depends on the larger one.
 *
 * The row holding [line][dot][line] centres its children, so a row only as tall
 * as its own dot puts the 2px connector at half of 14 in the current column and
 * half of 10 everywhere else. That drew the rail with a 3px step in it, right at
 * the step the rider is on — measured off a screenshot at rows 805-807 beside
 * "Accepted" against 802-804 for every other segment. Giving every row the
 * height of the largest dot puts one connector at one height.
 */
const DOT_CURRENT = 14;
const DOT_PLAIN = 10;

/**
 * How many steps are done when there are no timestamps to read.
 *
 * The list endpoint does not always carry them, and a status is always
 * present, so the rail still advances rather than sitting blank.
 */
const REACHED: Record<DeliveryStatus, number> = {
  offered: 0,
  accepted: 1,
  picked: 2,
  dispatched: 2,
  out_for_delivery: 3,
  delivered: 4,
  returning: 2,
  returned: 2,
  cancelled: 0,
  failed: 0,
};

export function GlassProgress({
  order,
  timezone,
}: {
  order: DeliveryOrder;
  timezone: string | undefined;
}) {
  const ts = order.timestamps;

  const times = STEPS.map(({ key }) => {
    const raw = ts?.[key];
    // '' is the contract's "not yet" — the key is always sent.
    return raw ? timeOnly(raw, timezone) : '';
  });

  // Prefer what the server timed. Fall back to status only when it sent nothing.
  const fromTimes = times.filter(Boolean).length;
  const reached = fromTimes > 0 ? fromTimes : REACHED[order.delivery_status] ?? 0;

  return (
    <View style={{ flexDirection: 'row' }}>
      {STEPS.map((step, i) => {
        const done = i < reached;
        const current = i === reached - 1;

        return (
          <View key={step.key} style={{ flex: 1, alignItems: 'center' }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                width: '100%',
                // Not the dot's own height — see DOT_CURRENT above.
                height: DOT_CURRENT,
              }}
            >
              {/* Half-width connectors either side of the dot, so the line
                  meets the dots rather than running under the labels. */}
              <Line filled={i > 0 && done} hidden={i === 0} />
              <Dot done={done} current={current} />
              <Line filled={i < reached - 1} hidden={i === STEPS.length - 1} />
            </View>

            <GlassText
              variant="caption"
              tone={done ? 'ink' : 'faint'}
              numberOfLines={1}
              style={{ marginTop: gspace.xs, fontSize: 11 }}
            >
              {step.label}
            </GlassText>

            {/* Only when the server actually timed it. */}
            <GlassText variant="caption" tone="faint" nums style={{ fontSize: 10 }}>
              {times[i] || ' '}
            </GlassText>
          </View>
        );
      })}
    </View>
  );
}

function Dot({ done, current }: { done: boolean; current: boolean }) {
  const size = current ? DOT_CURRENT : DOT_PLAIN;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: done ? glass.indigo : glass.bg,
        borderWidth: done ? (current ? 3 : 0) : 2,
        borderColor: current ? glass.indigo : done ? 'transparent' : glass.dividerDashed,
      }}
    />
  );
}

function Line({ filled, hidden }: { filled: boolean; hidden: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        height: 2,
        backgroundColor: hidden ? 'transparent' : filled ? glass.indigo : glass.dividerDashed,
      }}
    />
  );
}
