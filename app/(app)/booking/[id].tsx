import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bookingsApi } from '../../../src/api/danatfix';
import {
  BOOKING_ACTIONS,
  BookingAction,
  BookingsResponse,
  lineText,
  odooUtc,
} from '../../../src/api/danatfixTypes';
import { ApiError } from '../../../src/api/types';
import { useBookings } from '../../../src/hooks/useBookings';
import { useNow } from '../../../src/hooks/useNow';
import { CONTENT_MAX_W, gspace } from '../../../src/theme/glass';
import { servicePalette as S } from '../../../src/theme/workspace';
import { confirm, notice } from '../../../src/ui/ConfirmSheet';
import { GlassCard } from '../../../src/ui/glass/GlassCard';
import { GlassIcon, GlassIconName } from '../../../src/ui/glass/GlassIcon';
import { GlassScreen } from '../../../src/ui/glass/GlassScreen';
import { GlassText } from '../../../src/ui/glass/GlassText';
import { ago, BookingPill } from '../../../src/ui/service/BookingsHome';
import { SvcButton, SvcHeader } from '../../../src/ui/service/ServiceKit';
import { showToast } from '../../../src/ui/Toast';

/**
 * One website repair booking, with the Store Live Screen's own buttons:
 * Accept, Call customer first, Done, Cancel - whichever its state allows.
 * A tap goes through the same row lock as the counter's click, so if the
 * counter or the WhatsApp poll was first the server says so and the list
 * comes back fresh.
 */

const DONE_TOAST: Record<BookingAction, string> = {
  accept: 'Accepted',
  call: 'Marked as calling the customer',
  done: 'Marked done',
  cancel: 'Booking cancelled',
};

export default function BookingScreen() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = Number(raw);
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const now = useNow(30_000);
  const { data, isLoading } = useBookings();
  const [busy, setBusy] = useState<BookingAction | null>(null);

  const b = data?.rows.find((r) => r.id === id);

  async function act(action: BookingAction) {
    if (!b) return;
    if (action === 'done' || action === 'cancel') {
      const ok = await confirm(
        action === 'done'
          ? { title: `Mark ${b.name} done?`, message: 'The repair is finished. The booking closes at the counter too.', okLabel: 'Mark done' }
          : { title: `Cancel ${b.name}?`, message: 'The booking is cancelled for everyone, at the counter too.', okLabel: 'Cancel booking', cancelLabel: 'Keep it' }
      );
      if (!ok) return;
    }
    setBusy(action);
    try {
      const res = await bookingsApi.act(b.id, action);
      qc.setQueryData<BookingsResponse>(['bookings'], { rows: res.rows, new: res.new });
      void qc.invalidateQueries({ queryKey: ['bookings-history'] });
      if (res.warning) {
        await notice('Someone was quicker', res.warning);
      } else {
        showToast(`${b.name} · ${DONE_TOAST[action]}`);
      }
      if (action === 'call' && b.phone_digits) void Linking.openURL(`tel:+${b.phone_digits}`).catch(() => {});
      if (!res.rows.some((r) => r.id === b.id)) router.back();
    } catch (err) {
      await notice('Could not do that', err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      void qc.invalidateQueries({ queryKey: ['bookings'] });
    } finally {
      setBusy(null);
    }
  }

  if (!b) {
    return (
      <GlassScreen>
        <SvcHeader eyebrow="Website booking" title={isLoading ? 'Loading…' : 'Not open any more'} onBack={() => router.back()} />
        {!isLoading ? (
          <View style={{ padding: gspace.xl }}>
            <GlassText variant="body" tone="soft">
              This booking is done or cancelled, or the counter closed it.
            </GlassText>
          </View>
        ) : null}
      </GlassScreen>
    );
  }

  const actions = BOOKING_ACTIONS[b.state];
  const mapLink = b.map_url || (b.address || b.area ? `https://maps.google.com/?q=${encodeURIComponent([b.address, b.area].filter(Boolean).join(', '))}` : '');

  return (
    <GlassScreen>
      <SvcHeader eyebrow={`${b.name}${b.web_ref ? ` · ${b.web_ref}` : ''}`} title={b.customer || b.phone || 'Customer'} onBack={() => router.back()}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: gspace.sm, marginTop: gspace.xs }}>
          <BookingPill state={b.state} />
          <GlassText variant="caption" style={{ color: S.bandSoft }}>
            {ago(b.created, now)}
          </GlassText>
        </View>
      </SvcHeader>

      <ScrollView
        contentContainerStyle={{
          padding: gspace.xl,
          rowGap: gspace.md,
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxxl + insets.bottom,
        }}
      >
        <GlassCard>
          <GlassText variant="label" tone="soft" upper>
            Repairs
          </GlassText>
          {b.lines.length ? (
            b.lines.map((l) => (
              <GlassText key={l.id} variant="bodyStrong" style={{ marginTop: gspace.xs }}>
                {lineText(l)}
              </GlassText>
            ))
          ) : (
            <GlassText variant="body" tone="soft">
              No devices listed.
            </GlassText>
          )}
          {b.note ? (
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              {b.note}
            </GlassText>
          ) : null}
          {b.coupon ? (
            <GlassText variant="caption" tone="soft" style={{ marginTop: gspace.xs }}>
              Coupon: {b.coupon}
            </GlassText>
          ) : null}
        </GlassCard>

        <GlassCard>
          <GlassText variant="label" tone="soft" upper>
            Customer
          </GlassText>
          <GlassText variant="bodyStrong" style={{ marginTop: gspace.xs }}>
            {b.customer || '—'}
          </GlassText>
          {b.phone ? (
            <GlassText variant="body" tone="soft" nums>
              {b.phone}
            </GlassText>
          ) : null}
          <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
            {[b.address, b.area].filter(Boolean).join(', ') || 'No address given'}
          </GlassText>
          <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.md }}>
            <Contact icon="phone" label="Call" disabled={!b.phone_digits} onPress={() => Linking.openURL(`tel:+${b.phone_digits}`)} />
            <Contact icon="whatsapp" label="WhatsApp" disabled={!b.phone_digits} onPress={() => Linking.openURL(`https://wa.me/${b.phone_digits}`)} />
            <Contact icon="nav" label="Navigate" disabled={!mapLink} onPress={() => Linking.openURL(mapLink)} />
          </View>
        </GlassCard>

        <GlassText variant="caption" tone="faint">
          {[b.brand, b.source, b.taken_by ? `Taken by ${b.taken_by}` : '', b.created ? `Booked ${odooUtc(b.created).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '']
            .filter(Boolean)
            .join(' · ')}
        </GlassText>

        {actions.includes('accept') ? (
          <SvcButton title="Accept this booking" icon="check" loading={busy === 'accept'} disabled={!!busy} onPress={() => void act('accept')} />
        ) : null}
        {actions.includes('call') ? (
          <SvcButton title="Call customer first" icon="phone" kind="ghost" loading={busy === 'call'} disabled={!!busy} onPress={() => void act('call')} />
        ) : null}
        {actions.includes('done') ? (
          <SvcButton title="Mark done" icon="check" loading={busy === 'done'} disabled={!!busy} onPress={() => void act('done')} />
        ) : null}
        {actions.includes('cancel') ? (
          <SvcButton title="Cancel booking" kind="quiet" loading={busy === 'cancel'} disabled={!!busy} onPress={() => void act('cancel')} />
        ) : null}
      </ScrollView>
    </GlassScreen>
  );
}

function Contact({ icon, label, onPress, disabled }: { icon: GlassIconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        paddingVertical: gspace.md,
        borderRadius: 12,
        backgroundColor: S.soft,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      <GlassIcon name={icon} color={S.band} size={20} />
      <GlassText variant="caption" style={{ color: S.band, marginTop: 2 }}>
        {label}
      </GlassText>
    </Pressable>
  );
}
