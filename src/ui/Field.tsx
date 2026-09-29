import { ReactNode, useState } from 'react';
import { TextInput, TextInputProps, View } from 'react-native';
import { glass, gspace, poppins } from '../theme/glass';
import { GlassIcon, GlassIconName } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/**
 * Underlined input, not a boxed one — boxes read as cards, and this design has
 * no cards. The underline thickens and turns brand blue on focus.
 *
 * `icon` sits before the text and `right` after it (a show-password eye, say);
 * both live inside the underline so the line still spans the whole field.
 */
export function Field({
  label,
  icon,
  right,
  style,
  ...rest
}: TextInputProps & { label: string; icon?: GlassIconName; right?: ReactNode }) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ marginBottom: gspace.xl }}>
      <GlassText variant="label" tone="soft" upper style={{ marginBottom: gspace.sm }}>
        {label}
      </GlassText>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: focused ? 2 : 1,
          borderBottomColor: focused ? glass.indigo : glass.divider,
        }}
      >
        {icon ? (
          <GlassIcon
            name={icon}
            size={20}
            color={focused ? glass.indigo : glass.inkFaint}
            style={{ marginRight: gspace.md }}
          />
        ) : null}
        <TextInput
          allowFontScaling={false}
          placeholderTextColor={glass.inkFaint}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              fontFamily: poppins.medium,
              fontSize: 18,
              color: glass.ink,
              paddingVertical: gspace.md,
            },
            style,
          ]}
        />
        {right}
      </View>
    </View>
  );
}
