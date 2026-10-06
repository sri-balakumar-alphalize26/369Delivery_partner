import * as Location from 'expo-location';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, Switch, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sortForRider, useDuty, useOrders } from '../../src/hooks/useOrders';
import { money, onDutyFor } from '../../src/lib/format';
import { useNow } from '../../src/hooks/useNow';
import { useSession } from '../../src/store/session';
import { useRefreshOnFocus } from '../../src/hooks/useSettingsRefresh';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../src/theme/glass';
import { useWide } from '../../src/ui/useWide';
import { LocationPrimer } from '../../src/ui/LocationPrimer';
import { SharingRow } from '../../src/ui/SharingRow';
import { DutyWatchRow } from '../../src/ui/DutyWatchRow';
import { HereMap } from '../../src/ui/HereMap';
import { MAP_ENABLED } from '../../src/ui/RouteMap';
import {
  needsDutyLocationPermission,
  notifyLocationPermission,
} from '../../src/location/dutyLocation';

/**
 * Asked at most once per app session. A rider who said "Not now" is not asked
 * again every time Home remounts; the next launch may ask once more.
 */
let askedDutyLocation = false;
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassJobCard } from '../../src/ui/glass/GlassJobCard';
import { HomeJobCard } from '../../src/ui/glass/HomeJobCard';
import { GlassPill } from '../../src/ui/glass/GlassPill';
import { GlassProblem } from '../../src/ui/glass/GlassProblem';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';
import { NotificationsOffBanner, PhoneSetupCard } from '../../src/ui/PhoneSetupCard';
import { SosShield } from '../../src/ui/SosSheet';

/**
 * The rider's day, in the Glass Light style.
 *
 * Duty leads because it is the first thing that has to be true: the contract
 * offers nothing at all to an off-duty rider, so an app without this control
 * shows an empty list and no reason for it.
 *
 * The template puts today's earnings, a rating and a bonus chip on this screen.
 * None exist in the contract — there is no pay model in Odoo, `Rider` carries no
 * score, and `/orders` returns only active jobs so no daily total is derivable.
 * The card keeps the template's shape and carries the four counts Odoo does
 * return. A number here would be trusted, so it has to be real.
 */
export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rider = useSession((s) => s.rider);
  const timezone = useSession((s) => s.timezone);
  const area = useSession((s) => s.area);
  const { data, isLoading, isError, error, isRefetching, refetch } = useOrders();
  const duty = useDuty();
  const wide = useWide();
  // Tabs stay mounted, so the "you are here" map is told when Home is out of view.
  const focused = useIsFocused();
  // A Delivery Partner with the shop's partner riders switched off: nothing
  // will be offered, however long they stay on duty, so say so.
  const partnerIdle = useSession(
    (s) => s.rider?.kind === 'third_party' && s.thirdPartyEnabled === false
  );
  // Settings the office changed since this phone opened (sharing).
  useRefreshOnFocus();

  // No vehicle step: the delivery server keeps no vehicles, so the switch
  // clocks on directly.
  const setDuty = (on: boolean) => duty.mutate({ on });

  // The server is the authority on duty; the stored rider is only the fallback
  // before the first /orders comes back.
  const onDuty = data?.on_duty ?? rider?.on_duty ?? false;

  /**
   * On a fleet server the office's live map wants this rider's position while
   * they are on duty with the app open. Ask once, in words first, and only
   * once they are actually on duty — never at the switch itself.
   */
  const [askingLocation, setAskingLocation] = useState(false);
  const [grantingLocation, setGrantingLocation] = useState(false);
  useEffect(() => {
    if (!onDuty || askedDutyLocation) return;
    let alive = true;
    needsDutyLocationPermission().then((needed) => {
      if (!alive || !needed || askedDutyLocation) return;
      askedDutyLocation = true;
      setAskingLocation(true);
    });
    return () => {
      alive = false;
    };
  }, [onDuty]);

  const grantLocation = async () => {
    setGrantingLocation(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) notifyLocationPermission();
    } finally {
      setGrantingLocation(false);
      setAskingLocation(false);
    }
  };

  /**
   * How long this shift has been running.
   *
   * `duty_since` has been on the rider object all along and shown nowhere, so a
   * rider had no way to see their own shift from inside the app. Counted against
   * the server's clock, so a phone set wrong does not invent hours.
   */
  const now = useNow();
  const shift = onDuty ? onDutyFor(rider?.duty_since, now) : null;

  const jobs = sortForRider(data?.orders);
  const counts = data?.counts;

  // Genuinely derivable: what the rider is holding across the jobs in hand.
  const toCollect = jobs
    .filter((j) => j.payment_status === 'cod')
    .reduce((sum, j) => sum + (j.amount_to_collect ?? 0), 0);
  const currency = jobs.find((j) => j.currency)?.currency;

  return (
    <GlassScreen>
      {/* The greeting sits on the green band, outside the scroll view: the band
          has to run edge to edge, and the column below it stops at
          CONTENT_MAX_W on a tablet. It also stays put while the jobs scroll. */}
      <View
        style={{
          backgroundColor: glass.band,
          paddingTop: insets.top + gspace.lg,
          paddingBottom: gspace.lg,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: CONTENT_MAX_W,
            alignSelf: 'center',
            paddingHorizontal: gspace.xl,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: gspace.md }}>
            <View style={{ flex: 1 }}>
              <GlassText variant="caption" style={{ color: glass.bandSoft }}>
                {greeting()}
              </GlassText>
              <GlassText variant="hero" tone="white" numberOfLines={1}>
                {rider?.name ?? 'Rider'}
              </GlassText>
            </View>
            {/* Emergency help, always in the same corner (SosSheet.tsx). */}
            <SosShield />
          </View>
          {/* No bell: nothing registers for push (useOrders polls instead), so
              it would be a control that does nothing. */}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gspace.xl,
          // A column, not a full-width sprawl. Binds only above CONTENT_MAX_W.
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxxl + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
        /* A rider's first instinct is to pull. Until now that did nothing. */
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
        }
      >
        {/* The band carries on under the duty card, so the card sits over it. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: -1000,
            right: -1000,
            height: 56,
            backgroundColor: glass.band,
          }}
        />
        <GlassCard
          padding={18}
          style={{
            marginTop: gspace.xs,
            borderRadius: 20,
            shadowColor: '#0F3D2E',
            shadowOpacity: 0.12,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            elevation: 4,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: onDuty ? glass.green : glass.inkFaint,
                  marginRight: gspace.sm,
                }}
              />
              <View style={{ flex: 1 }}>
                <GlassText variant="bodyStrong">
                  {onDuty ? 'You are online' : 'You are off duty'}
                </GlassText>
                {shift ? (
                  <GlassText variant="caption" tone="soft" nums>
                    {shift} on duty
                  </GlassText>
                ) : null}
                {/* Where the server placed the clock-on fix — the same place the
                    shop ranks this rider from. */}
                {onDuty && area ? (
                  <GlassText variant="caption" tone="soft" numberOfLines={1}>
                    You are in {area}
                  </GlassText>
                ) : null}
              </View>
            </View>
            <Switch
              value={onDuty}
              disabled={duty.isPending}
              onValueChange={setDuty}
              trackColor={{ true: glass.green, false: glass.dividerDashed }}
              // Android's default thumb is its own blue accent.
              thumbColor={onDuty ? glass.accent : glass.white}
            />
          </View>


          {/* The day at a glance, inside the duty card. */}
          <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.lg }}>
            <Stat
              label="Delivered today"
              value={counts?.delivered_today ?? counts?.delivered ?? 0}
              onPress={() => router.push('/orders')}
            />
            <Stat
              label="On the road"
              value={(counts?.picked_up ?? 0) + (counts?.out_for_delivery ?? 0)}
              // The tile counts collected and on-the-road jobs; open whichever
              // filter holds them, never an empty one.
              onPress={() =>
                router.push(
                  counts?.out_for_delivery
                    ? '/orders?bucket=out_for_delivery'
                    : '/orders?bucket=picked_up'
                )
              }
            />
            <Stat label="Cash to collect" value={money(toCollect, currency)} />
          </View>
          {counts?.delivered_week !== undefined ? (
            <GlassText variant="caption" tone="soft" nums style={{ marginTop: gspace.sm }}>
              {counts.delivered_week} this week · {counts.delivered_month ?? 0} this month
              {counts?.assigned ? ` · ${counts.assigned} assigned` : ''}
            </GlassText>
          ) : null}

          {/* Whether the office's live map can see this rider. */}
          {onDuty ? <SharingRow /> : null}
          {/* Whether a new job will ring with the phone locked. */}
          {onDuty ? <DutyWatchRow /> : null}
        </GlassCard>

        {/* Phone settings a job alert depends on: a warning when notifications
            are off, and the setup checklist until it is done. */}
        <View style={{ marginTop: gspace.lg, rowGap: gspace.md }}>
          <NotificationsOffBanner />
          <PhoneSetupCard />
        </View>

        {partnerIdle ? (
          <GlassProblem
            tone="quiet"
            message="The shop is not using partner riders right now, so no offers will arrive. Your history and pay are still here."
          />
        ) : null}


        <Modal
          visible={askingLocation}
          transparent
          animationType="fade"
          onRequestClose={() => setAskingLocation(false)}
          statusBarTranslucent
        >
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              backgroundColor: 'rgba(15,23,42,0.45)',
            }}
          >
            <View style={{ width: '100%', maxWidth: CONTENT_MAX_W, alignSelf: 'center' }}>
              <LocationPrimer
                purpose="duty"
                busy={grantingLocation}
                onContinue={grantLocation}
                onSkip={() => setAskingLocation(false)}
              />
            </View>
          </View>
        </Modal>

        {/* Where the rider is right now. On duty only, and its GPS pauses
            whenever another tab is in view. */}
        {onDuty && MAP_ENABLED ? (
          <GlassCard padding={12} style={{ marginTop: gspace.lg }}>
            <HereMap active={focused} />
          </GlassCard>
        ) : null}

        {/* Odoo writes this for the rider — "2 job(s) were waiting." */}
        {duty.data?.message ? (
          <GlassText variant="bodyStrong" tone="indigo" style={{ marginTop: gspace.lg }}>
            {duty.data.message}
          </GlassText>
        ) : null}
        {duty.isError ? (
          <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
            {duty.error.message}
          </GlassText>
        ) : null}

        {/* The count as a chip rather than trailing the words, so the heading
            stays one short phrase whatever the number is. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: gspace.xxl,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: gspace.sm }}>
            <GlassText variant="subtitle">
              {jobs.length > 1 ? 'Active jobs' : 'Active job'}
            </GlassText>
            {jobs.length > 1 ? <GlassPill label={String(jobs.length)} tone="soft" /> : null}
          </View>
          <Pressable
            onPress={() => router.push('/orders')}
            accessibilityRole="link"
            hitSlop={10}
          >
            <GlassText variant="bodyStrong" tone="indigo">
              See all
            </GlassText>
          </Pressable>
        </View>

        {/* A failed refresh with jobs already on screen keeps the jobs. Losing
            a rider's list to one dropped poll is worse than the dropped poll. */}
        {isError && data ? (
          <GlassProblem
            tone="quiet"
            message="Could not refresh just now. Showing the last jobs received."
          />
        ) : null}

        {jobs.length ? (
          /* Two across on a tablet, one on a phone. A single column stretched
             to 800dp wastes the width as surely as the centred column that was
             here before did. */
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: gspace.md,
              marginTop: gspace.md,
            }}
          >
            <View style={{ width: '100%' }}>
              <HomeJobCard
                job={jobs[0]}
                timezone={timezone}
                onPress={() => router.push(`/order/${jobs[0].delivery_order_id}`)}
              />
            </View>
            {jobs.slice(1).map((job) => (
              <View
                key={job.delivery_order_id}
                style={wide ? { flexBasis: 0, flexGrow: 1, minWidth: 320 } : { width: '100%' }}
              >
                <GlassJobCard
                  job={job}
                  timezone={timezone}
                  onPress={() => router.push(`/order/${job.delivery_order_id}`)}
                />
              </View>
            ))}
          </View>
        ) : isError ? (
          /* Never "Nothing to deliver" when the truth is that nobody asked. */
          <GlassProblem
            message={error.message}
            onRetry={() => refetch()}
            retrying={isRefetching}
          />
        ) : (
          <GlassCard style={{ marginTop: gspace.md }}>
            <GlassText variant="subtitle">
              {isLoading ? 'Checking for jobs…' : onDuty ? 'Nothing to deliver' : 'Nothing yet'}
            </GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              {onDuty
                ? 'New jobs appear here by themselves, and the phone rings when one arrives.'
                : 'Go online to pick up whatever is waiting.'}
            </GlassText>
          </GlassCard>
        )}

      </ScrollView>
    </GlassScreen>
  );
}

/** Local time of day — the one thing here the server has no view of. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * One of the three figures under the day's total.
 *
 * A number a rider cannot open is half an answer: "On road 2" invites the
 * question "which two?", and until now nothing happened. Tapping carries the
 * bucket to the jobs screen, which filters to it.
 *
 * A tile reading zero stays inert. There is nothing behind it, and an empty
 * list is a worse answer to a tap than no response at all.
 */
function Stat({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string | number;
  onPress?: () => void;
}) {
  const box: ViewStyle = {
    flex: 1,
    backgroundColor: glass.fill,
    borderRadius: gradius.chip,
    borderWidth: 1,
    borderColor: glass.border,
    paddingVertical: gspace.md,
    paddingHorizontal: gspace.md,
  };

  const body = (
    <>
      <GlassText variant="subtitle" nums>
        {value}
      </GlassText>
      <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
        {label}
      </GlassText>
    </>
  );

  if (!onPress || Number(value) < 1) return <View style={box}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      /* Number and label in one phrase. The two Texts are otherwise announced
         as loose fragments — "3", then "Assigned" — which is not a sentence. */
      accessibilityLabel={`${label}, ${value} ${Number(value) === 1 ? 'job' : 'jobs'}. Opens the list.`}
      hitSlop={6}
      style={({ pressed }) => ({ ...box, opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}
