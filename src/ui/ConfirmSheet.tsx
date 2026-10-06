import { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassText } from './glass/GlassText';

/**
 * "Are you sure?" for the steps a rider cannot take back: signing out, giving a
 * job away, returning a parcel. The OK is red and the Cancel white, so the safe
 * choice is the calm one. Android's own Alert cannot colour its buttons.
 *
 * One host for the whole app (mounted in the root layout, like the camera);
 * screens call `confirm()` and await the answer. Drawn inside the app's own
 * window rather than as a Modal, which once stayed white and took every tap.
 */

export type ConfirmOptions = {
  title: string;
  message?: string;
  /** The red button, e.g. "Sign out". Defaults to "OK". */
  okLabel?: string;
  cancelLabel?: string;
  /** One lime OK and no Cancel: news to read, not a choice. Set by `notice()`. */
  notice?: boolean;
};

let open: ((o: ConfirmOptions) => Promise<boolean>) | null = null;

/** Resolves true on OK; false on Cancel, Back, or a tap outside. */
export function confirm(o: ConfirmOptions): Promise<boolean> {
  return open ? open(o) : Promise.resolve(false);
}

/**
 * The app's own message box in place of Android's Alert: title, words, one OK.
 * Resolves when it is closed, however that happens.
 */
export async function notice(title: string, message?: string): Promise<void> {
  await confirm({ title, message, notice: true });
}

export function ConfirmHost() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    open = (o) =>
      new Promise<boolean>((resolve) => {
        // A second ask while one is open answers the first as cancelled.
        settle.current?.(false);
        settle.current = resolve;
        Keyboard.dismiss();
        setOpts(o);
      });
    return () => {
      open = null;
    };
  }, []);

  function finish(ok: boolean) {
    settle.current?.(ok);
    settle.current = null;
    setOpts(null);
  }

  useEffect(() => {
    if (!opts) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      finish(false);
      return true;
    });
    return () => sub.remove();
  }, [opts]);

  if (!opts) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1100, elevation: 1100 }]}>
      <Pressable
        onPress={() => finish(false)}
        accessibilityLabel="Cancel"
        style={{
          flex: 1,
          backgroundColor: 'rgba(15,23,42,0.45)',
          justifyContent: 'center',
          padding: gspace.xl,
        }}
      >
        {/* Taps on the card itself stay on the card. */}
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%',
            maxWidth: 420,
            alignSelf: 'center',
            backgroundColor: glass.white,
            borderRadius: gradius.card,
            padding: gspace.xl,
          }}
        >
          <GlassText variant="title" accessibilityRole="header">
            {opts.title}
          </GlassText>
          {opts.message ? (
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              {opts.message}
            </GlassText>
          ) : null}

          <View style={{ flexDirection: 'row', gap: gspace.md, marginTop: gspace.xl }}>
            {opts.notice ? null : (
              <Pressable
                onPress={() => finish(false)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flex: 1,
                  height: 48,
                  borderRadius: gradius.button,
                  borderWidth: 1,
                  borderColor: glass.border,
                  backgroundColor: glass.white,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <GlassText variant="button" style={{ color: glass.ink }}>
                  {opts.cancelLabel ?? 'Cancel'}
                </GlassText>
              </Pressable>
            )}
            <Pressable
              onPress={() => finish(true)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flex: 1,
                height: 48,
                borderRadius: gradius.button,
                // A notice is news, not a risk: the app's own lime, not red.
                backgroundColor: opts.notice ? glass.accent : glass.red,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <GlassText
                variant="button"
                style={{ color: opts.notice ? glass.accentInk : glass.white }}
              >
                {opts.okLabel ?? 'OK'}
              </GlassText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </View>
  );
}
