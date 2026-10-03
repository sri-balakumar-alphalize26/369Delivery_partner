import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { glass, gspace } from '../theme/glass';
import { GlassText } from './glass/GlassText';

const LENGTH = 6;

/** A digit is one character wide; the box only has to be comfortable to tap. */
const BOX_W = 46;
const BOX_H = 54;

/**
 * The six-box delivery code.
 *
 * One real `TextInput`, positioned off-screen, holds the value and takes the
 * keyboard; the six boxes are just views rendering its digits. Six separate
 * inputs would mean managing focus between them, and paste and autofill both
 * break when the code is split across fields.
 *
 * Same value/onChange/error contract as `OtpInput`, so screens can swap between
 * them without touching their logic.
 */
/** What a parent can do to these boxes from outside. */
export type OtpBoxesHandle = { focus: () => void };

type OtpBoxesProps = {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  autoFocus?: boolean;
  /** Box width; the code popup sizes it to the space it has. Height is 6px more. */
  boxSize?: number;
  /** While a code is being checked: digits can't change under it. */
  disabled?: boolean;
};

export const OtpBoxes = forwardRef<OtpBoxesHandle, OtpBoxesProps>(function OtpBoxes(
  { value, onChange, error, autoFocus, boxSize = BOX_W, disabled },
  ref
) {
  const input = useRef<TextInput>(null);

  /**
   * Focus from outside, for a caller that knows when the keyboard may open.
   *
   * `autoFocus` fires as this mounts, which inside a modal on Android is often
   * before the window is actually on screen — the request is then dropped and
   * the keyboard never appears, which is exactly what a rider reported. A parent
   * that can wait for the modal to be shown calls this instead.
   */
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  const [focused, setFocused] = useState(false);

  const digits = value.split('');
  // The box the next keystroke lands in, so exactly one reads as active.
  const cursor = Math.min(value.length, LENGTH - 1);

  return (
    <View>
      <Pressable
        onPress={() => input.current?.focus()}
        accessibilityRole="none"
        style={{ flexDirection: 'row', gap: gspace.sm }}
      >
        {Array.from({ length: LENGTH }).map((_, i) => {
          const active = focused && !disabled && i === cursor;
          return (
            <View
              key={i}
              accessibilityLabel={`Digit ${i + 1} of ${LENGTH}${digits[i] ? `, ${digits[i]}` : ''}`}
              style={{
                // Fixed rather than flex:1. Stretching to the container made
                // each box about 190px wide on a full-width tablet — six
                // enormous panels for six digits.
                width: boxSize,
                height: boxSize === BOX_W ? BOX_H : boxSize + 6,
                borderRadius: 8,
                // The box being typed into wears the app's primary, green on a
                // pale lime fill, so it reads as "here" at a glance.
                backgroundColor: error ? glass.redSoft : active ? glass.accentSoft : glass.bg,
                borderWidth: 2,
                borderColor: error ? glass.red : active ? glass.band : glass.border,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <GlassText variant="title" nums style={{ color: glass.ink, fontSize: 24 }}>
                {digits[i] ?? ''}
              </GlassText>
            </View>
          );
        })}
      </Pressable>

      <TextInput
        ref={input}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={LENGTH}
        autoFocus={autoFocus}
        editable={!disabled}
        accessibilityLabel={`${LENGTH}-digit code`}
        // Off-screen rather than `display: none` — a hidden input cannot hold
        // focus, and the keyboard would never open.
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />

      {error ? (
        <GlassText
          variant="caption"
          // Read out by a screen reader the moment it appears.
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={{ color: glass.red, marginTop: gspace.sm, textAlign: 'center' }}
        >
          {error}
        </GlassText>
      ) : null}
    </View>
  );
});
