import { Linking, Pressable, View } from 'react-native';
import { COUNT_BUCKET, CountBucket, DeliveryOrder, headingFor, stopLabel } from '../api/types';
import { money, shopInfo, shopName, shopPhone, timeOnly } from '../lib/format';
import { openNavigation } from '../lib/navigate';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/**
 * The jobs in hand, grouped the way the work happens (layout B of the Orders
 * canvas, 6 Oct 2026): On the road, Collected, To pick up, then anything else.
 *
 * Only the job to do now - the first of the first group - is drawn large, with
 * Navigate, Call and Open. Every other job is a short row: a number, who, where
 * and when, and the cash. The rider sees the next step without reading cards.
 */

type Group = { key: CountBucket | 'other'; title: string; dot: string };

const GROUPS: Group[] = [
  { key: 'out_for_delivery', title: 'On the road', dot: glass.accentLine },
  { key: 'picked_up', title: 'Collected · ready to leave', dot: glass.green },
  { key: 'assigned', title: 'To pick up', dot: glass.band },
  { key: 'other', title: 'Other', dot: glass.dividerDashed },
];

function groupOf(job: DeliveryOrder): Group['key'] {
  for (const k of ['out_for_delivery', 'picked_up', 'assigned'] as const) {
    if (COUNT_BUCKET[k].includes(job.delivery_status)) return k;
  }
  return 'other';
}

/** Who and where the rider is going next for this job. */
function target(job: DeliveryOrder) {
  const toCustomer = headingFor(job.delivery_status) === 'customer';
  const shop = shopInfo(job.shop);
  return toCustomer
    ? {
        who: job.customer_name,
        where: job.delivery_address || '',
        phone: job.customer_mobile || '',
        dest: { latitude: job.latitude, longitude: job.longitude, address: job.delivery_address },
      }
    : {
        who: shopName(job.shop) || 'The shop',
        where: `Pick up for ${job.customer_name}`,
        phone: shopPhone(job.shop),
        dest: { latitude: shop?.latitude, longitude: shop?.longitude, address: shop?.address },
      };
}

function cashText(job: DeliveryOrder): string {
  return job.payment_status === 'cod' ? money(job.amount_to_collect, job.currency) : 'Paid';
}

export function StageList({
  jobs,
  only,
  timezone,
  onOpen,
}: {
  jobs: DeliveryOrder[];
  /** Home's tile asked for one group only. */
  only?: CountBucket | null;
  timezone?: string;
  onOpen: (job: DeliveryOrder) => void;
}) {
  const groups = GROUPS.map((g) => ({ ...g, jobs: jobs.filter((j) => groupOf(j) === g.key) })).filter(
    (g) => g.jobs.length > 0 && (!only || g.key === only)
  );
  // The job to do now: the first of the first group shown.
  const current = groups[0]?.jobs[0];

  return (
    <View style={{ rowGap: gspace.xl }}>
      {groups.map((g) => (
        <View key={g.key} style={{ rowGap: gspace.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: gspace.sm }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: g.dot }} />
            <GlassText variant="label" upper>
              {g.title}
            </GlassText>
            <GlassText variant="label" tone="soft" nums>
              {g.jobs.length}
            </GlassText>
          </View>
          {g.jobs.map((job, i) =>
            job === current ? (
              <CurrentJob key={job.delivery_order_id} job={job} n={i + 1} timezone={timezone} onOpen={onOpen} />
            ) : (
              <JobRow key={job.delivery_order_id} job={job} n={i + 1} timezone={timezone} onOpen={onOpen} />
            )
          )}
        </View>
      ))}
    </View>
  );
}

/** The stop number: the run's own when there is one, else the place in its group. */
function Badge({ job, n, strong }: { job: DeliveryOrder; n: number; strong?: boolean }) {
  const label = stopLabel(job) ? String(job.run_stop_no) : String(n);
  const shop = headingFor(job.delivery_status) === 'shop';
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: shop ? 10 : 20,
        backgroundColor: strong ? glass.accent : glass.fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {shop ? (
        <GlassIcon name="store" size={20} color={glass.band} />
      ) : (
        <GlassText variant="subtitle" style={{ color: glass.accentInk }}>
          {label}
        </GlassText>
      )}
    </View>
  );
}

function subLine(job: DeliveryOrder, timezone?: string): string {
  const t = target(job);
  const due = timeOnly(job.promised_by, timezone);
  return [t.where, due ? `due ${due}` : null].filter(Boolean).join(' · ');
}

function JobRow({
  job,
  n,
  timezone,
  onOpen,
}: {
  job: DeliveryOrder;
  n: number;
  timezone?: string;
  onOpen: (job: DeliveryOrder) => void;
}) {
  const t = target(job);
  return (
    <Pressable
      onPress={() => onOpen(job)}
      accessibilityRole="button"
      accessibilityLabel={`${t.who}. ${subLine(job, timezone)}. Open the job.`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: gspace.md,
        padding: gspace.md,
        borderRadius: gradius.card,
        borderWidth: 1,
        borderColor: glass.divider,
        backgroundColor: pressed ? glass.fill : glass.white,
      })}
    >
      <Badge job={job} n={n} />
      <View style={{ flex: 1 }}>
        <GlassText variant="bodyStrong" numberOfLines={1}>
          {t.who}
        </GlassText>
        <GlassText variant="caption" tone="soft" numberOfLines={1} style={{ marginTop: 2 }}>
          {subLine(job, timezone)}
        </GlassText>
      </View>
      <GlassText variant="caption" tone={job.payment_status === 'cod' ? undefined : 'soft'} nums style={{ fontWeight: '700' }}>
        {cashText(job)}
      </GlassText>
      <GlassIcon name="chev" size={16} color={glass.inkFaint} />
    </Pressable>
  );
}

function CurrentJob({
  job,
  n,
  timezone,
  onOpen,
}: {
  job: DeliveryOrder;
  n: number;
  timezone?: string;
  onOpen: (job: DeliveryOrder) => void;
}) {
  const t = target(job);
  const stop = stopLabel(job);
  return (
    <View
      style={{
        padding: gspace.md,
        rowGap: gspace.md,
        borderRadius: gradius.card,
        borderWidth: 2,
        borderColor: glass.accentLine,
        backgroundColor: glass.white,
      }}
    >
      <Pressable
        onPress={() => onOpen(job)}
        accessibilityRole="button"
        accessibilityLabel={`${t.who}. Open the job.`}
        style={{ flexDirection: 'row', alignItems: 'center', columnGap: gspace.md }}
      >
        <Badge job={job} n={n} strong />
        <View style={{ flex: 1 }}>
          {stop ? (
            <GlassText variant="label" style={{ color: glass.accentText }}>
              {stop}
            </GlassText>
          ) : null}
          <GlassText variant="subtitle" numberOfLines={1}>
            {t.who}
          </GlassText>
          <GlassText variant="caption" tone="soft" numberOfLines={2} style={{ marginTop: 2 }}>
            {subLine(job, timezone)}
          </GlassText>
        </View>
        <GlassText variant="bodyStrong" nums>
          {cashText(job)}
        </GlassText>
      </Pressable>
      <View style={{ flexDirection: 'row', columnGap: gspace.sm }}>
        <GlassButton
          title="Navigate"
          kind="dark"
          icon="nav"
          onPress={() => void openNavigation(t.dest)}
          style={{ flex: 1 }}
        />
        {t.phone ? (
          <GlassButton
            title="Call"
            kind="ghost"
            icon="phone"
            onPress={() => void Linking.openURL(`tel:${t.phone.replace(/[^\d+]/g, '')}`).catch(() => {})}
            style={{ flex: 1 }}
          />
        ) : null}
        <GlassButton title="Open" kind="green" onPress={() => onOpen(job)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
