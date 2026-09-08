import { ReactNode, useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { glass, gradius, gspace } from '../theme/glass';
import { OtpBoxes, OtpBoxesHandle } from './OtpBoxes';
import { GlassButton } from './glass/GlassButton';
import { GlassText } from './glass/GlassText';

/**
 * Entering the six-digit code, on a panel that holds nothing else.
 *
 * The boxes used to sit at the foot of the job sheet, below the progress rail,
 * the order details, three tiles and the item list — so a rider at a counter
 * scrolled to find them and then had the keyboard cover them anyway. The
 * `KeyboardAvoidingView` around that sheet was already fighting the problem and
 * still losing, because the problem was never that the page would not scroll: a
 * single-keystroke task was buried in a page about something else.
 *
 * So the code gets its own surface. Nothing to scroll past, and the panel sits
 * above the keyboard by construction rather than by measurement.
 *
 * The keyboard inset is tracked rather than left to `KeyboardAvoidingView`:
 * app.json turns edge-to-edge on, which stops Android resizing the window when
 * the keyboard opens, so nothing moves on its own.
 */
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
  right,
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
  /** The resend link, on the steps that have one. */
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // The Android back button closes it, as a rider would expect of anything
      // that slid up over the screen.
      onRequestClose={onClose}
      /**
       * The keyboard is raised here rather than by `autoFocus` on the input.
       *
       * On Android `autoFocus` runs while the modal is still mounting, before
       * its window exists, and the focus request is dropped — the panel opens
       * and no keyboard ever appears. `onShow` is the callback that means the
       * window is really up, so the request lands.
       */
      onShow={() => boxes.current?.focus()}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Tapping away is a cancel. The panel below stops the press, so a
            mistyped digit does not close everything. */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }}
        />

        <View
          style={{
            backgroundColor: glass.fillStrong,
            borderTopLeftRadius: gradius.card,
            borderTopRightRadius: gradius.card,
            paddingHorizontal: gspace.xl,
            paddingTop: gspace.xl,
            // The keyboard first, then the gesture bar when there is no keyboard
            // over it.
            paddingBottom: gspace.xl + (keyboard || insets.bottom),
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <GlassText variant="label" tone="soft" upper>
              {title}
            </GlassText>
            {right}
          </View>

          <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
            {hint}
          </GlassText>

          {/* Centred, unlike the old inline version: six 46px boxes pinned to
              the left of a 1100px tablet sheet read as a rendering fault. */}
          <View style={{ alignItems: 'center', marginTop: gspace.xl }}>
            <OtpBoxes ref={boxes} value={value} onChange={onChange} error={error} />
          </View>

          <GlassButton
            title={submitLabel}
            kind={submitKind}
            icon="check"
            onPress={onSubmit}
            loading={busy}
            disabled={!canSubmit}
            style={{ marginTop: gspace.xl }}
          />
        </View>
      </View>
    </Modal>
  );
}
