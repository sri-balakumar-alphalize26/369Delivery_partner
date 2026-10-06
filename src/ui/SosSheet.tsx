import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { peekServer } from '../api/config';
import { useBottomInset } from '../hooks/useBottomInset';
import { openWhatsApp } from '../lib/navigate';
import { emergencyNumber, SosOutcome, sendSos, sosMessage } from '../lib/sos';
import { useSession } from '../store/session';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/** How long the button must be held. Long enough that a pocket can't do it. */
const HOLD_MS = 3000;
const SIZE = 180;
const RED = '#C62828';
const RED_SOFT = '#FDE2E2';

/**
 * The SOS sheet, opened from the red shield in the top band.
 *
 * Hold the big button for three seconds: a red fill grows inside it, and when
 * it is full the SOS goes, with no "Are you sure?" - in a real emergency there
 * is no time for a second question, and the hold is what stops an accidental
 * one. Letting go early cancels.
 *
 * Then: whether the office was reached, a WhatsApp per emergency contact with
 * the location typed in, and the emergency and office numbers to call.
 */
export function SosSheet({
  visible,
  onClose,
  orderId,
  orderRef,
}: {
  visible: boolean;
  onClose: () => void;
  orderId?: number;
  orderRef?: string;
}) {
  const bottomInset = useBottomInset();
  const riderName = useSession((s) => s.rider?.name) ?? 'a rider';
  const timezone = useSession((s) => s.timezone);
  const [stage, setStage] = useState<'hold' | 'sending' | 'sent'>('hold');
  const [outcome, setOutcome] = useState<SosOutcome | null>(null);
  const fill = useRef(new Animated.Value(0)).current;
  const holding = useRef<Animated.CompositeAnimation | null>(null);

  // A fresh sheet each time it opens.
  useEffect(() => {
    if (!visible) return;
    setStage('hold');
    setOutcome(null);
    fill.setValue(0);
  }, [visible, fill]);

  const start = () => {
    if (stage !== 'hold') return;
    holding.current = Animated.timing(fill, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    holding.current.start(({ finished }) => {
      if (!finished) return;
      setStage('sending');
      void sendSos(orderId).then((o) => {
        setOutcome(o);
        setStage('sent');
      });
    });
  };

  const release = () => {
    if (stage !== 'hold') return;
    holding.current?.stop();
    Animated.timing(fill, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  };

  const call = (n: string) => void Linking.openURL(`tel:${n.replace(/[^\d+]/g, '')}`).catch(() => {});
  const emergency = emergencyNumber(timezone);
  const office = peekServer().supportPhone;

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={stage === 'sending' ? undefined : onClose} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: glass.white,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingHorizontal: gspace.xl,
            paddingTop: gspace.xl,
            paddingBottom: bottomInset + gspace.lg,
            alignItems: 'center',
            rowGap: gspace.md,
          }}
        >
          {stage !== 'sent' ? (
            <>
              <GlassText variant="title" style={{ color: RED, textAlign: 'center' }}>
                {stage === 'sending' ? 'Sending SOS…' : 'Hold for 3 seconds'}
              </GlassText>
              <Pressable
                onPressIn={start}
                onPressOut={release}
                disabled={stage === 'sending'}
                accessibilityRole="button"
                accessibilityLabel="SOS. Press and hold for 3 seconds to send."
                style={{
                  width: SIZE,
                  height: SIZE,
                  borderRadius: SIZE / 2,
                  backgroundColor: RED_SOFT,
                  borderWidth: 6,
                  borderColor: RED,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  marginVertical: gspace.md,
                }}
              >
                {/* The fill that grows while the button is held. */}
                <Animated.View
                  style={{
                    position: 'absolute',
                    width: SIZE,
                    height: SIZE,
                    borderRadius: SIZE / 2,
                    backgroundColor: RED,
                    transform: [{ scale: fill }],
                  }}
                />
                <GlassText variant="amount" style={{ color: glass.white, textShadowColor: RED, textShadowRadius: 6 }}>
                  SOS
                </GlassText>
              </Pressable>
              <GlassText variant="body" tone="soft" style={{ textAlign: 'center' }}>
                Sends your live location to the office and your emergency contacts. Let go to cancel.
              </GlassText>
              <View style={{ flexDirection: 'row', columnGap: gspace.md, alignSelf: 'stretch' }}>
                <GlassButton title={`Call ${emergency}`} kind="danger" icon="phone" onPress={() => call(emergency)} style={{ flex: 1 }} />
                <GlassButton title="Cancel" kind="ghost" onPress={onClose} style={{ flex: 1 }} disabled={stage === 'sending'} />
              </View>
            </>
          ) : (
            <SentView
              outcome={outcome}
              message={sosMessage(riderName, outcome?.fix ?? null, orderRef)}
              emergency={emergency}
              office={office}
              call={call}
              onClose={onClose}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function SentView({
  outcome,
  message,
  emergency,
  office,
  call,
  onClose,
}: {
  outcome: SosOutcome | null;
  message: string;
  emergency: string;
  office: string;
  call: (n: string) => void;
  onClose: () => void;
}) {
  const reached = outcome?.office === 'sent';
  const contacts = outcome?.contacts ?? [];
  return (
    <>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: RED,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <GlassIcon name="shield" size={32} color={glass.white} />
      </View>
      <GlassText variant="title" style={{ color: RED }}>
        SOS sent
      </GlassText>
      <View
        style={{
          alignSelf: 'stretch',
          padding: gspace.md,
          borderRadius: gradius.card,
          backgroundColor: reached ? glass.greenSoft : glass.orangeSoft,
        }}
      >
        <GlassText variant="bodyStrong" tone={reached ? 'green' : 'orange'}>
          {reached ? 'The office has been alerted.' : 'Trying to reach the office…'}
        </GlassText>
        <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
          {reached
            ? 'They can see where you are.'
            : 'No signal or no answer yet. It keeps trying for 10 minutes. Call or message below too.'}
        </GlassText>
      </View>

      {contacts.length ? (
        contacts.map((c) => (
          <GlassButton
            key={c.phone}
            title={`WhatsApp ${c.name || c.phone}`}
            kind="green"
            icon="whatsapp"
            onPress={() => openWhatsApp(c.phone, message)}
            style={{ alignSelf: 'stretch' }}
          />
        ))
      ) : (
        <GlassText variant="caption" tone="soft" style={{ textAlign: 'center' }}>
          No emergency contacts yet. Add up to two in Profile.
        </GlassText>
      )}

      <View style={{ flexDirection: 'row', columnGap: gspace.md, alignSelf: 'stretch' }}>
        <GlassButton title={`Call ${emergency}`} kind="danger" icon="phone" onPress={() => call(emergency)} style={{ flex: 1 }} />
        {office ? (
          <GlassButton title="Call office" kind="ghost" icon="phone" onPress={() => call(office)} style={{ flex: 1 }} />
        ) : null}
      </View>
      <GlassButton title="Close" kind="ghost" onPress={onClose} style={{ alignSelf: 'stretch' }} />
    </>
  );
}

/**
 * The red shield for the green top band (Home and the job screen). A tap opens
 * the SOS sheet; nothing is sent until its button is held.
 */
export function SosShield({ orderId, orderRef }: { orderId?: number; orderRef?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="SOS. Emergency help."
        hitSlop={8}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: 4,
          height: 36,
          paddingHorizontal: gspace.md,
          borderRadius: 18,
          backgroundColor: pressed ? '#A61F1F' : RED,
        })}
      >
        <GlassIcon name="shield" size={16} color={glass.white} />
        <GlassText variant="label" tone="white">
          SOS
        </GlassText>
      </Pressable>
      <SosSheet visible={open} onClose={() => setOpen(false)} orderId={orderId} orderRef={orderRef} />
    </>
  );
}
