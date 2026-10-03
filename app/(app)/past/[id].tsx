import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../src/api/endpoints';
import { HistoryResponse, PastJob } from '../../../src/api/types';
import { useHistory } from '../../../src/hooks/useOrders';
import { money, promisedAt, shopInfo, shopName } from '../../../src/lib/format';
import { useSession } from '../../../src/store/session';
import {
  CONTENT_MAX_W,
  GlassBarState,
  glass,
  glassBand,
  gspace,
} from '../../../src/theme/glass';
import { LoadingArt } from '../../../src/ui/LoadingArt';
import { GlassButton } from '../../../src/ui/glass/GlassButton';
import { GlassCard } from '../../../src/ui/glass/GlassCard';
import { GlassHeader } from '../../../src/ui/glass/GlassHeader';
import { GlassIcon, GlassIconName } from '../../../src/ui/glass/GlassIcon';
import { GlassPill } from '../../../src/ui/glass/GlassPill';
import { GlassProgress } from '../../../src/ui/glass/GlassProgress';
import { GlassScreen } from '../../../src/ui/glass/GlassScreen';
import { GlassText } from '../../../src/ui/glass/GlassText';

/**
 * A finished job, read-only, opened from Orders → Past.
 *
 * Filled first from the row the Past list already holds, so it opens at once
 * and works even if the server refuses `/orders/{id}` for a job that is over.
 * When the server does answer, its fuller record — the step times, the items —
 * is laid over the row. Nothing here acts on the job: it is done.
 *
 * No customer phone number. The delivery is finished, and a number shown long
 * after the handover is one the customer never agreed to leave with the rider.
 */
export default function PastJobScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const sessionTz = useSession((s) => s.timezone);

  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = Number(id);
  const validId = Number.isFinite(jobId) && jobId > 0;

  // Opened from the list, the row is already cached; fetch the list only when
  // it is not (the app reopened onto this screen).
  const inCache = qc
    .getQueryData<HistoryResponse>(['history'])
    ?.jobs.some((j) => j.delivery_order_id === jobId);
  const history = useHistory(!inCache);
  const row = history.data?.jobs.find((j) => j.delivery_order_id === jobId);

  // Its own key: never the active job screen's polled `['order', id]`.
  const detailQuery = useQuery({
    queryKey: ['past-order', jobId],
    queryFn: () => api.order(jobId),
    enabled: validId,
    retry: false,
    staleTime: Infinity,
  });
  const detail = detailQuery.data;

  const base: PastJob | undefined = row ?? detail;
  const job: PastJob | undefined = base
    ? { ...base, ...(detail ?? {}), finished_at: row?.finished_at ?? detail?.delivered_at }
    : undefined;
  const timezone = history.data?.timezone ?? sessionTz;

  const back = () => (router.canGoBack() ? router.back() : router.replace('/orders'));

  if (!job) {
    const waiting = history.isLoading || detailQuery.isLoading;
    return (
      <GlassScreen>
        <GlassHeader title="Past job" onBack={back} />
        {waiting ? (
          <LoadingArt />
        ) : (
          <View style={{ paddingHorizontal: gspace.xl }}>
            <GlassCard>
              <GlassText variant="subtitle">This job isn&rsquo;t in your recent history</GlassText>
              <GlassButton title="Back" kind="ghost" onPress={back} style={{ marginTop: gspace.lg }} />
            </GlassCard>
          </View>
        )}
      </GlassScreen>
    );
  }

  const band = glassBand[job.delivery_status as GlassBarState] ?? glassBand.idle;
  const delivered = job.delivery_status === 'delivered';
  const cod = job.payment_status === 'cod';
  const shop = shopInfo(job.shop);
  const from = shopName(job.shop);
  const finished = promisedAt(job.finished_at, timezone);
  const promised = promisedAt(job.promised_by, timezone);

  return (
    <GlassScreen>
      <GlassHeader title="Past job" onBack={back} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gspace.xl,
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxxl + insets.bottom,
          gap: gspace.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* What it was and how it ended. */}
        <GlassCard>
          <View style={{ flexDirection: 'row', gap: gspace.sm }}>
            <GlassPill label={band.label} bg={band.bg} fg={band.fg} />
            {job.delivery_type ? <GlassPill label={job.delivery_type} tone="soft" /> : null}
          </View>
          <GlassText variant="title" style={{ marginTop: gspace.md }}>
            {job.delivery_order_name}
          </GlassText>
          {job.job_code ? (
            <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
              {job.job_code}
            </GlassText>
          ) : null}
          {finished ? (
            <Line label="Finished" value={finished} style={{ marginTop: gspace.md }} />
          ) : null}
          {promised ? <Line label="Promised" value={promised} /> : null}
        </GlassCard>

        <Section icon="store" title="Picked up from">
          <GlassText variant="bodyStrong">{from || 'Shop not recorded'}</GlassText>
          {shop?.address ? (
            <GlassText variant="body" tone="soft" style={{ marginTop: 2 }}>
              {shop.address}
            </GlassText>
          ) : null}
        </Section>

        <Section icon="pin" title="Delivered to">
          <GlassText variant="bodyStrong">{job.customer_name}</GlassText>
          {job.delivery_address ? (
            <GlassText variant="body" tone="soft" style={{ marginTop: 2 }}>
              {job.delivery_address}
            </GlassText>
          ) : null}
          {job.delivery_note?.trim() ? (
            <GlassText variant="bodyStrong" style={{ marginTop: gspace.xs }}>
              {job.delivery_note.trim()}
            </GlassText>
          ) : null}
        </Section>

        <Section icon="box" title="Items">
          {job.products?.length ? (
            job.products.map((p, i) => (
              <View
                key={`${p.name}-${i}`}
                style={{ flexDirection: 'row', marginTop: i === 0 ? 0 : gspace.sm }}
              >
                <GlassText variant="body" style={{ flex: 1, paddingRight: gspace.md }}>
                  {p.name}
                </GlassText>
                <GlassText variant="bodyStrong" nums>
                  ×{p.quantity}
                  {p.uom ? ` ${p.uom}` : ''}
                </GlassText>
              </View>
            ))
          ) : (
            <GlassText variant="body" tone={job.items_summary ? 'ink' : 'soft'}>
              {job.items_summary || 'No items listed'}
            </GlassText>
          )}
        </Section>

        <Section icon="cash" title="Payment">
          {cod ? (
            <>
              <GlassText variant="bodyStrong" tone={delivered ? 'ink' : 'soft'} nums>
                {delivered ? 'Cash collected' : 'Cash not collected'} ·{' '}
                {money(job.amount_to_collect, job.currency)}
              </GlassText>
              {!delivered ? (
                <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
                  The parcel did not reach the customer, so no cash changed hands.
                </GlassText>
              ) : null}
            </>
          ) : (
            <GlassText variant="bodyStrong">Paid online</GlassText>
          )}
          {/* What the trip paid this rider: Delivery Partners only, frozen once
              delivered, and 0 for a returned or cancelled trip (server's rule). */}
          {job.rider_fee ? (
            <GlassText variant="bodyStrong" nums style={{ marginTop: gspace.sm, color: glass.green }}>
              You earned {job.rider_fee.formatted}
            </GlassText>
          ) : null}
        </Section>

        {/* The step times, from the server where it sent them. */}
        <Section icon="clock" title="Timeline">
          <GlassProgress order={job} timezone={timezone} />
        </Section>
      </ScrollView>
    </GlassScreen>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: GlassIconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: gspace.sm }}>
        <GlassIcon name={icon} size={16} color={glass.inkSoft} />
        <GlassText variant="label" tone="soft" upper style={{ marginLeft: gspace.sm }}>
          {title}
        </GlassText>
      </View>
      {children}
    </GlassCard>
  );
}

function Line({
  label,
  value,
  style,
}: {
  label: string;
  value: string;
  style?: { marginTop?: number };
}) {
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }, style]}>
      <GlassText variant="body" tone="soft">
        {label}
      </GlassText>
      <GlassText variant="bodyStrong" nums>
        {value}
      </GlassText>
    </View>
  );
}
