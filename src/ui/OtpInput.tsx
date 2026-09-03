import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { glass, gspace, poppins } from '../theme/glass';
import { GlassText } from './glass/GlassText';

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
      <GlassText variant="label" tone="soft" upper>
        {label}
      </GlassText>
      {hint ? (
        <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
          {hint}
        </GlassText>
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
        placeholderTextColor={glass.divider}
        style={{
          fontFamily: poppins.bold,
          fontSize: 42,
          letterSpacing: 10,
          color: glass.ink,
          paddingVertical: gspace.md,
          marginTop: gspace.sm,
          borderBottomWidth: focused ? 2 : 1,
          borderBottomColor: error ? glass.red : focused ? glass.indigo : glass.divider,
        }}
      />

      {error ? (
        <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.sm }}>
          {error}
        </GlassText>
      ) : null}
    </View>
  );
}
