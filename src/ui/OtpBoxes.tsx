import { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { cardColor, cardRadius, space } from '../theme/tokens';
import { Text } from './Text';

const LENGTH = 6;

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
export function OtpBoxes({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  autoFocus?: boolean;
}) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const digits = value.split('');
  // The box the next keystroke lands in, so exactly one reads as active.
  const cursor = Math.min(value.length, LENGTH - 1);

  return (
    <View>
      <Pressable
        onPress={() => input.current?.focus()}
        accessibilityRole="none"
        style={{ flexDirection: 'row', gap: space.sm }}
      >
        {Array.from({ length: LENGTH }).map((_, i) => {
          const active = focused && i === cursor;
          return (
            <View
              key={i}
              style={{
                flex: 1,
                aspectRatio: 0.92,
                borderRadius: cardRadius.chip,
                backgroundColor: cardColor.chipBg,
                borderWidth: 2,
                borderColor: error
                  ? cardColor.red
                  : active
                    ? cardColor.brand
                    : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="cardStat" nums style={{ color: cardColor.textPrimary }}>
                {digits[i] ?? ''}
              </Text>
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
        // Off-screen rather than `display: none` — a hidden input cannot hold
        // focus, and the keyboard would never open.
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />

      {error ? (
        <Text variant="cardCaption" style={{ color: cardColor.red, marginTop: space.sm }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
