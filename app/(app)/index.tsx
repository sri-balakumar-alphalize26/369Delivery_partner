import * as Location from 'expo-location';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, Switch, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sortForRider, useDuty, useOrders, useTakeVehicle } from '../../src/hooks/useOrders';
import { money, onDutyFor } from '../../src/lib/format';
import { useNow } from '../../src/hooks/useNow';
import { useSession } from '../../src/store/session';
import { useRefreshOnFocus } from '../../src/hooks/useSettingsRefresh';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../src/theme/glass';
import { useWide } from '../../src/ui/useWide';
import { VehicleSheet } from '../../src/ui/VehicleSheet';
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
import { GlassIcon } from '../../src/ui/glass/GlassIcon';
import { GlassJobCard } from '../../src/ui/glass/GlassJobCard';
import { GlassPill } from '../../src/ui/glass/GlassPill';
import { GlassProblem } from '../../src/ui/glass/GlassProblem';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';

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
  // Only a server with delivery_fleet_ops sends this; without it the switch
  // clocks on directly, as it always has.
  const fleet = useSession((s) => s.fleet);
  // Settings the office changed since this phone opened (vehicles, sharing).
  useRefreshOnFocus();
  const [pickingVehicle, setPickingVehicle] = useState(false);
  const take = useTakeVehicle();

  const setDuty = (on: boolean, vehicleId?: number) => {
    setPickingVehicle(false);
    take.reset();
    duty.mutate({ on, vehicleId });
  };

  const pickVehicle = (vehicleId: number) => {
    if (!onDuty) return setDuty(true, vehicleId);
    setPickingVehicle(false);
    duty.reset();
    take.mutate(vehicleId);
  };

  // The server is the authority on duty; the stored rider is only the fallback
  // before the first /orders comes back.
  const onDuty = data?.on_duty ?? rider?.on_duty ?? false;

  /**
   * On a fleet server the office's live map wants this rider's position while
   * they are on duty with the app open. Ask once, in words first, and only
   * once they are actually on duty — never at the switch itself, where the
   * vehicle sheet is already asking something.
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
  }, [onDuty, fleet]);

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
          <GlassText variant="caption" style={{ color: glass.bandSoft }}>
            {greeting()}
          </GlassText>
          <GlassText variant="hero" tone="white" numberOfLines={1}>
            {rider?.name ?? 'Rider'}
          </GlassText>
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
        <GlassCard padding={16} style={{ marginTop: gspace.lg }}>
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
              onValueChange={(next) =>
                next && fleet ? setPickingVehicle(true) : setDuty(next)
              }
              trackColor={{ true: glass.green, false: glass.dividerDashed }}
              // Android's default thumb is its own blue accent.
              thumbColor={onDuty ? glass.accent : glass.white}
            />
          </View>

          {/* The vehicle in hand, and the way to swap it mid-shift. */}
          {fleet && onDuty ? (
            <Pressable
              onPress={() => setPickingVehicle(true)}
              accessibilityRole="button"
              accessibilityLabel={
                fleet.vehicle
                  ? `Riding ${fleet.vehicle.plate || fleet.vehicle.name}. Change vehicle.`
                  : 'No vehicle. Pick one.'
              }
              hitSlop={6}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: gspace.md,
                paddingTop: gspace.md,
                borderTopWidth: 1,
                borderTopColor: glass.divider,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <GlassIcon
                name={fleet.vehicle?.type === 'car' ? 'car' : 'bike'}
                color={glass.inkSoft}
                size={20}
                style={{ marginRight: gspace.sm }}
              />
              <GlassText variant="body" style={{ flex: 1 }} numberOfLines={1}>
                {fleet.vehicle
                  ? `${fleet.vehicle.plate || fleet.vehicle.name}${
                      fleet.vehicle.model ? ` · ${fleet.vehicle.model}` : ''
                    }`
                  : 'No vehicle'}
              </GlassText>
              <GlassText variant="caption" tone="indigo">
                {fleet.vehicle ? 'Change' : 'Pick one'}
              </GlassText>
            </Pressable>
          ) : null}

          {/* Whether the office's live map can see this rider. */}
          {onDuty ? <SharingRow /> : null}
          {/* Whether a new job will ring with the phone locked. */}
          {onDuty ? <DutyWatchRow /> : null}
        </GlassCard>

        <VehicleSheet
          visible={pickingVehicle}
          onDuty={onDuty}
          busy={duty.isPending || take.isPending}
          onPick={pickVehicle}
          onSkip={() => setDuty(true)}
          onClose={() => setPickingVehicle(false)}
        />

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

        <GlassCard style={{ marginTop: gspace.lg }}>
          {/* Alone among the four, this one does not open anything: delivered
              rows are dropped from /orders and there is no history call to ask
              for them, so there is no list behind the number to show. */}
          <GlassText variant="caption" tone="soft">
            Delivered today
          </GlassText>
          <GlassText variant="amount" nums style={{ marginTop: 2 }}>
            {counts?.delivered ?? 0}
          </GlassText>

          {/* Cash rides in this card's corner rather than a card of its own at
              the foot of the list: it is a figure about the day, like the ones
              below it, and a rider wants it beside them rather than after two
              screens of scrolling. Hidden at zero, where it is only noise. */}
          {toCollect > 0 ? (
            <View
              style={{
                position: 'absolute',
                right: 18,
                top: 18,
                alignItems: 'flex-end',
              }}
            >
              <GlassText variant="caption" tone="soft">
                Cash to collect
              </GlassText>
              <GlassText variant="bodyStrong" tone="orange" nums>
                {money(toCollect, currency)}
              </GlassText>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.lg }}>
            <Stat
              label="Assigned"
              value={counts?.assigned ?? 0}
              onPress={() => router.push('/orders?bucket=assigned')}
            />
            <Stat
              label="Collected"
              value={counts?.picked_up ?? 0}
              onPress={() => router.push('/orders?bucket=picked_up')}
            />
            <Stat
              label="On road"
              value={counts?.out_for_delivery ?? 0}
              onPress={() => router.push('/orders?bucket=out_for_delivery')}
            />
          </View>
        </GlassCard>

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
        {take.data?.message ? (
          <GlassText variant="bodyStrong" tone="indigo" style={{ marginTop: gspace.lg }}>
            {take.data.message}
          </GlassText>
        ) : null}
        {take.isError ? (
          <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
            {take.error.message}
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
          <GlassText variant="subtitle">
            {jobs.length === 1 ? 'Active order' : 'Active orders'}
          </GlassText>
          {jobs.length ? <GlassPill label={String(jobs.length)} tone="soft" /> : null}
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
            {jobs.map((job) => (
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
