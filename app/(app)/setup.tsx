import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, View } from 'react-native';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { checklist, openFor, SetupItem, tick } from '../../src/lib/phoneSetup';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../src/theme/glass';
import { GlassButton } from '../../src/ui/glass/GlassButton';
import { GlassHeader } from '../../src/ui/glass/GlassHeader';
import { GlassIcon } from '../../src/ui/glass/GlassIcon';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';

/**
 * "Set up your phone": every setting a job alert depends on, in one list, the
 * way Zepto and Blinkit walk a new rider through it. Opened from the card on
 * Home and from Profile.
 *
 * Each row says why it matters, has one button to the right settings page, and
 * shows done or to do. Rows the phone cannot report (battery, full-screen ring,
 * Do Not Disturb, autostart) get "I've done this" after the button is used.
 * Re-checked whenever the app comes back from the settings app.
 */
export default function PhoneSetup() {
  const router = useRouter();
  const bottomInset = useBottomInset();
  const [items, setItems] = useState<SetupItem[] | null>(null);
  /** Rows whose settings page has been opened, so "I've done this" can show. */
  const [visited, setVisited] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    checklist()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  const done = items?.filter((i) => i.done).length ?? 0;
  const total = items?.length ?? 0;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <GlassScreen>
      <GlassHeader title="Set up your phone" onBack={back} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gspace.xl,
          paddingBottom: bottomInset + gspace.xl,
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          rowGap: gspace.md,
        }}
      >
        <View style={{ rowGap: gspace.xs }}>
          <GlassText variant="body" tone="soft">
            So every new job rings, even with the phone locked, on silent or in your pocket.
          </GlassText>
          {items ? (
            <GlassText variant="label" upper tone={done === total ? 'green' : 'orange'}>
              {done === total ? 'All done' : `${done} of ${total} done`}
            </GlassText>
          ) : null}
        </View>

        {(items ?? []).map((item) => (
          <View
            key={item.key}
            style={{
              padding: gspace.lg,
              borderRadius: gradius.card,
              borderWidth: 1,
              borderColor: item.done ? glass.accentLine : glass.border,
              backgroundColor: glass.white,
              rowGap: gspace.sm,
            }}
          >
            <View style={{ flexDirection: 'row', columnGap: gspace.md, alignItems: 'flex-start' }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: item.done ? glass.greenSoft : glass.orangeSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <GlassIcon
                  name={item.done ? 'check' : 'alert'}
                  size={18}
                  color={item.done ? glass.green : glass.orange}
                />
              </View>
              <View style={{ flex: 1 }}>
                <GlassText variant="bodyStrong">{item.title}</GlassText>
                <GlassText variant="body" tone="soft" style={{ marginTop: 2 }}>
                  {item.why}
                </GlassText>
                {item.steps && !item.done ? (
                  <GlassText variant="caption" style={{ marginTop: gspace.xs }}>
                    {item.steps}
                  </GlassText>
                ) : null}
              </View>
            </View>

            {item.done ? (
              item.checked ? null : (
                <Pressable
                  onPress={() => void tick(item.key, false).then(load)}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <GlassText variant="caption" tone="soft">
                    Not done after all? Show it again
                  </GlassText>
                </Pressable>
              )
            ) : (
              <View style={{ flexDirection: 'row', columnGap: gspace.sm }}>
                <GlassButton
                  title={item.button}
                  kind="green"
                  icon="settings"
                  onPress={() => {
                    setVisited((v) => new Set(v).add(item.key));
                    void openFor(item.key).then(load);
                  }}
                  style={{ flex: 1 }}
                />
                {!item.checked && visited.has(item.key) ? (
                  <GlassButton
                    title="I've done this"
                    kind="ghost"
                    icon="check"
                    onPress={() => void tick(item.key).then(load)}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </GlassScreen>
  );
}
