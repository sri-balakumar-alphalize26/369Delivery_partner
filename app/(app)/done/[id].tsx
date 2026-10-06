import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomInset } from '../../../src/hooks/useBottomInset';
import { feedback } from '../../../src/lib/feedback';
import { timeOnly } from '../../../src/lib/format';
import { useSession } from '../../../src/store/session';
import { glass, gradius, gspace } from '../../../src/theme/glass';
import { GlassButton } from '../../../src/ui/glass/GlassButton';
import { GlassCard } from '../../../src/ui/glass/GlassCard';
import { GlassIcon } from '../../../src/ui/glass/GlassIcon';
import { GlassScreen } from '../../../src/ui/glass/GlassScreen';
import { GlassText } from '../../../src/ui/glass/GlassText';

/** How long the screen stays before it goes back to the jobs by itself. */
const STAY_S = 8;

/** Wide enough for a phone, narrow enough not to sprawl on a tablet. */
const MAX_W = 480;

/**
 * "Delivered — thank you" after the customer's code and the delivery photos.
 *
 * The end of a job: a big green tick, the order, the customer, the time it was
 * handed over and, for a Delivery Partner, what the trip paid. Everything comes
 * in the route's params from the photo screen - the job has already left
 * /orders, and nothing here is worth a fetch. Back to the jobs by the button,
 * by Android's back, or by itself after a few seconds.
 */
export default function Done() {
  const { ref, customer, fee, at } = useLocalSearchParams<{
    id: string;
    ref?: string;
    customer?: string;
    fee?: string;
    at?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomInset();
  const name = useSession((s) => s.rider?.name);
  const timezone = useSession((s) => s.timezone);

  const [left, setLeft] = useState(STAY_S);

  const home = () => router.replace('/');

  // Two rising notes and a buzz: the job is done.
  useEffect(() => {
    feedback.success();
  }, []);

  useEffect(() => {
    if (left <= 0) {
      home();
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      home();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstName = (name ?? '').trim().split(/\s+/)[0];
  const time = timeOnly(at || undefined, timezone);

  return (
    <GlassScreen>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingTop: insets.top + gspace.xxl,
          paddingHorizontal: gspace.xl,
          paddingBottom: bottomInset + gspace.xl,
        }}
      >
        <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center', alignItems: 'center' }}>
          <View
            style={{
              width: 112,
              height: 112,
              borderRadius: 56,
              backgroundColor: glass.greenSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: glass.green,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GlassIcon name="check" size={48} color={glass.white} />
            </View>
          </View>

          <GlassText
            variant="hero"
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            style={{ marginTop: gspace.xl, textAlign: 'center', alignSelf: 'stretch' }}
          >
            Delivered
          </GlassText>
          <GlassText
            variant="subtitle"
            tone="green"
            style={{ marginTop: gspace.xs, textAlign: 'center' }}
          >
            {firstName ? `Thank you, ${firstName}!` : 'Thank you!'}
          </GlassText>

          <GlassCard style={{ marginTop: gspace.xxl, alignSelf: 'stretch' }} padding={gspace.xl}>
            {ref ? <Row label="Order" value={ref} /> : null}
            {customer ? <Row label="Customer" value={customer} /> : null}
            {time ? <Row label="Delivered at" value={time} /> : null}
            {fee ? (
              <View
                style={{
                  marginTop: gspace.md,
                  borderRadius: gradius.chip,
                  backgroundColor: glass.greenSoft,
                  paddingVertical: gspace.md,
                  paddingHorizontal: gspace.lg,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <GlassText variant="body" tone="soft">
                  You earn on this trip
                </GlassText>
                <GlassText variant="title" tone="green" nums>
                  {fee}
                </GlassText>
              </View>
            ) : null}
          </GlassCard>

          <GlassButton
            title="Back to jobs"
            kind="green"
            icon="home"
            onPress={home}
            style={{ marginTop: gspace.xxl, alignSelf: 'stretch' }}
          />
          <GlassText
            variant="caption"
            tone="soft"
            nums
            style={{ marginTop: gspace.md, textAlign: 'center' }}
          >
            {left > 0 ? `Going back by itself in ${left}s` : ' '}
          </GlassText>
        </View>
      </ScrollView>
    </GlassScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingVertical: gspace.sm,
        gap: gspace.lg,
      }}
    >
      <GlassText variant="body" tone="soft">
        {label}
      </GlassText>
      <GlassText variant="bodyStrong" nums style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </GlassText>
    </View>
  );
}
