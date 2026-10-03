import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { glass, gspace } from '../theme/glass';
import { OtpBoxes, OtpBoxesHandle } from './OtpBoxes';
import { GlassButton } from './glass/GlassButton';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/**
 * Entering a six-digit code, in a small card centred over the job.
 *
 * The boxes once sat at the foot of the job sheet, under everything else, and
 * the keyboard covered them; then they moved to a bottom sheet. Now the code
 * gets a card of its own, centred in the space above the keyboard: a title, a
 * line saying where the code came from, the boxes, and one button. No resend:
 * neither code can be sent again from the rider's side.
 *
 * It submits by itself on the sixth digit, shakes and clears on a wrong code,
 * and shows a tick on a right one before it closes.
 *
 * The keyboard inset is tracked rather than left to `KeyboardAvoidingView`:
 * app.json turns edge-to-edge on, which stops Android resizing the window when
 * the keyboard opens, so nothing moves on its own.
 */

/** Wide enough for six full-size boxes and the card's padding: 6×48 + 5×8 + 2×28. */
const CARD_MAX_W = 384;
/** Space kept between the card and the screen edge on a narrow phone. */
const SCREEN_MARGIN = 16;
const BOX_MAX = 48;
const BOX_GAP = gspace.sm;
const DIGITS = 6;
/** How long the tick shows after a right code, before the card goes. */
const SUCCESS_MS = 700;
/** When the keyboard is asked for a second time, after the card is up. */
const REFOCUS_MS = 300;

export function CodeSheet({
  visible,
  title,
  hint,
  value,
  onChange,
  error,
  busy,
  canSubmit,
  submitLabel,
  submitKind = 'indigo',
  onSubmit,
  onClose,
  sentTo,
}: {
  visible: boolean;
  title: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  busy?: boolean;
  canSubmit: boolean;
  submitLabel: string;
  /** Green at the door, navy at the shop — the same colours those steps already use. */
  submitKind?: 'indigo' | 'green';
  onSubmit: () => void;
  onClose: () => void;
  /** The number the code went to, shown with all but its last four digits hidden. */
  sentTo?: string | null;
}) {
  const { width } = useWindowDimensions();
  const [keyboard, setKeyboard] = useState(0);
  const boxes = useRef<OtpBoxesHandle>(null);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setKeyboard(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Sized from the space the card really has, so the six boxes can never spill
  // past its edges: full size on most phones, a little smaller on narrow ones.
  const cardW = Math.min(CARD_MAX_W, width - 2 * SCREEN_MARGIN);
  const padH = width < 360 ? 24 : 28;
  const boxSize = Math.min(BOX_MAX, Math.floor((cardW - 2 * padH - (DIGITS - 1) * BOX_GAP) / DIGITS));

  /**
   * Whether the last close followed a submit that went through.
   *
   * There is no "it worked" prop: the caller just closes the card. A right code
   * closes it with no error and the boxes cleared; every failure either leaves
   * it open, sets `error`, or closes it with the digits still in. Only the
   * first is a success.
   */
  const submitting = useRef(false);
  const [shown, setShown] = useState(visible);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (visible) {
      setShown(true);
      setSuccess(false);
      return;
    }
    const ok = submitting.current && !error && value === '';
    submitting.current = false;
    if (!ok) {
      setShown(false);
      return;
    }
    setSuccess(true);
    const t = setTimeout(() => {
      setSuccess(false);
      setShown(false);
    }, SUCCESS_MS);
    return () => clearTimeout(t);
    // Only the open/close itself decides this; error and value are read as
    // they stand at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submit = () => {
    submitting.current = true;
    onSubmit();
  };

  const close = () => {
    submitting.current = false;
    onClose();
  };

  /**
   * The sixth digit submits. Once per complete code: a wrong one is cleared by
   * the caller, which re-arms this, and a refusal that leaves the digits in
   * place (the bag check) does not fire again until they change.
   */
  const lastSubmitted = useRef<string | null>(null);
  useEffect(() => {
    if (!visible || value.length < DIGITS) {
      lastSubmitted.current = null;
      return;
    }
    if (canSubmit && !busy && lastSubmitted.current !== value) {
      lastSubmitted.current = value;
      submit();
    }
    // `submit` is rebuilt each render; the value reaching six digits is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, visible, canSubmit, busy]);

  /** A wrong code: a short shake, and the boxes ready for the next try. */
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!error) return;
    submitting.current = false;
    Animated.sequence(
      [-8, 8, -6, 6, -3, 0].map((toValue) =>
        Animated.timing(shake, { toValue, duration: 50, useNativeDriver: true })
      )
    ).start();
    boxes.current?.focus();
  }, [error, shake]);

  /**
   * The keyboard, asked for once more a moment after the card is up.
   *
   * Android drops a focus request made before the popup's window has focus,
   * and `onShow` can come that early: the customer-code card, opened straight
   * after "Reached" came back from the server, showed with no keyboard the
   * first time. Asking again while the boxes are live costs nothing if the
   * first request landed.
   */
  useEffect(() => {
    if (!shown || busy) return;
    const t = setTimeout(() => boxes.current?.focus(), REFOCUS_MS);
    return () => clearTimeout(t);
  }, [shown, busy]);

  const masked = maskPhone(sentTo);

  return (
    <Modal
      visible={shown}
      transparent
      animationType="fade"
      // The Android back button closes it, as a rider would expect of a popup.
      onRequestClose={close}
      /**
       * The keyboard is raised here rather than by `autoFocus` on the input.
       *
       * On Android `autoFocus` runs while the modal is still mounting, before
       * its window exists, and the focus request is dropped — the card opens
       * and no keyboard ever appears. `onShow` is the callback that means the
       * window is really up, so the request lands.
       */
      onShow={() => boxes.current?.focus()}
      statusBarTranslucent
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.4)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: SCREEN_MARGIN,
          // Centred in what the keyboard leaves, not in the whole screen.
          paddingBottom: keyboard,
        }}
      >
        {/* Tapping away is a cancel. The card sits on top, so a press on it
            never reaches this. */}
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
        />

        <View
          style={{
            width: cardW,
            backgroundColor: glass.white,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: glass.border,
            paddingVertical: 32,
            paddingHorizontal: padH,
            alignItems: 'center',
            // The app draws no shadows elsewhere; a card floating over a dimmed
            // screen is the one place a soft one helps it lift.
            shadowColor: '#000000',
            shadowOpacity: 0.18,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
          }}
        >
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={({ pressed }) => ({
              position: 'absolute',
              top: 12,
              right: 12,
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? glass.fill : 'transparent',
            })}
          >
            <GlassIcon name="close" size={20} color={glass.inkSoft} />
          </Pressable>

          {success ? (
            <View style={{ alignItems: 'center', paddingVertical: gspace.lg }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: glass.greenSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <GlassIcon name="check" size={30} color={glass.green} />
              </View>
              <GlassText
                variant="subtitle"
                accessibilityLiveRegion="polite"
                style={{ marginTop: gspace.md, color: glass.green }}
              >
                Code accepted
              </GlassText>
            </View>
          ) : (
            <>
              <GlassText variant="subtitle" style={{ fontSize: 18, textAlign: 'center' }}>
                {title}
              </GlassText>
              <GlassText
                variant="body"
                tone="soft"
                style={{ fontSize: 13, textAlign: 'center', marginTop: gspace.sm }}
              >
                {hint}
              </GlassText>
              {masked ? (
                <GlassText
                  variant="body"
                  tone="soft"
                  nums
                  style={{ fontSize: 13, textAlign: 'center', marginTop: 2 }}
                >
                  Sent to {masked}
                </GlassText>
              ) : null}

              <Animated.View
                style={{ marginTop: gspace.xl, transform: [{ translateX: shake }] }}
              >
                <OtpBoxes
                  ref={boxes}
                  value={value}
                  onChange={onChange}
                  error={error}
                  boxSize={boxSize}
                  disabled={busy}
                />
              </Animated.View>

              <GlassButton
                title={submitLabel}
                kind={submitKind}
                icon="check"
                onPress={submit}
                loading={busy}
                disabled={!canSubmit}
                style={{ marginTop: gspace.xl, alignSelf: 'stretch' }}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** "+968 9123 4521" → "•••• •••• 4521": every digit but the last four hidden. */
function maskPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `•••• •••• ${digits.slice(-4)}`;
}
