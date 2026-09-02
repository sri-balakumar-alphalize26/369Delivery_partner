import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { color, font, space } from '../theme/tokens';
import { Text } from './Text';

/**
 * Six-digit code entry, used at both ends of the job — the shop reads out the
 * pickup code, the customer reads out the delivery code.
 *
 * Codes are six digits, expire, work once, and lock after five wrong attempts,
 * so the error line has to carry the server's own wording rather than a generic
 * "wrong code".
 */
export function OtpInput({
  label,
  hint,
  value,
  onChange,
  error,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View>
      <Text variant="label" tone="soft" upper>
        {label}
      </Text>
      {hint ? (
        <Text variant="body" tone="soft" style={{ marginTop: space.xs }}>
          {hint}
        </Text>
      ) : null}

      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        allowFontScaling={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="000000"
        placeholderTextColor={color.hairline}
        style={{
          fontFamily: font.bold,
          fontSize: 42,
          letterSpacing: 10,
          color: color.ink,
          paddingVertical: space.md,
          marginTop: space.sm,
          borderBottomWidth: focused ? 2 : 1,
          borderBottomColor: error ? color.red : focused ? color.brand : color.hairline,
        }}
      />

      {error ? (
        <Text variant="bodyStrong" tone="red" style={{ marginTop: space.sm }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
