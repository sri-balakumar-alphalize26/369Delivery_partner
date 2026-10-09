import { router } from 'expo-router';
import { useEffect } from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WorkLine } from '../api/types';
import { useWorkload } from '../hooks/useWorkload';
import { useSession } from '../store/session';
import { glass, gradius, gspace } from '../theme/glass';
import { paletteFor, WORKSPACE_HOME, WORKSPACE_LABEL } from '../theme/workspace';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';
import { useOverlay } from './OverlayHost';

/**
 * The Instagram-style switch for someone who works in both lines: one row per
 * side, a badge where an offer is waiting, a tick on the side that is open.
 *
 * Drawn through `OverlayHost`, not a Modal, for the reason given there.
 */

const SUB: Record<WorkLine, string> = {
  delivery: 'Parcels from the shop',
  service: 'Repairs and installs',
};

/** Open `ws` and land on its home. Shared by the sheet, Profile and the paused card. */
export function switchTo(ws: WorkLine) {
  const s = useSession.getState();
  if (!s.lines.includes(ws)) return;
  s.setWorkspace(ws);
  router.replace(WORKSPACE_HOME[ws]);
}

export function WorkspaceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { lines, workspace } = useSession();
  const { offers } = useWorkload();

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  useOverlay(
    visible ? (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ flex: 1, backgroundColor: 'rgba(11,31,23,0.45)' }}
        />
        <View
          style={{
            backgroundColor: glass.bg,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingHorizontal: gspace.xl,
            paddingTop: gspace.md,
            paddingBottom: insets.bottom + gspace.xl,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: glass.divider,
              marginBottom: gspace.lg,
            }}
          />
          <GlassText variant="title">Switch workspace</GlassText>
          <View style={{ marginTop: gspace.lg, gap: gspace.md }}>
            {lines.map((ws) => {
              const p = paletteFor(ws);
              const current = ws === workspace;
              const waiting = offers[ws];
              return (
                <Pressable
                  key={ws}
                  onPress={() => {
                    onClose();
                    if (!current) switchTo(ws);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: current }}
                  accessibilityLabel={`${WORKSPACE_LABEL[ws]}. ${SUB[ws]}${waiting ? `. ${waiting} offer waiting` : ''}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: gspace.md,
                    padding: gspace.md,
                    minHeight: 64,
                    borderRadius: gradius.card,
                    borderWidth: current ? 2 : 1,
                    borderColor: current ? p.band : glass.border,
                    backgroundColor: current ? p.soft : glass.fillStrong,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      backgroundColor: p.band,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <GlassIcon name={ws === 'service' ? 'tool' : 'box'} color={p.bandInk} size={22} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <GlassText variant="bodyStrong">{WORKSPACE_LABEL[ws]}</GlassText>
                    <GlassText variant="caption" tone="soft">
                      {current ? 'Open now' : SUB[ws]}
                    </GlassText>
                  </View>
                  {waiting && !current ? (
                    <View
                      style={{
                        backgroundColor: glass.red,
                        borderRadius: gradius.pill,
                        paddingHorizontal: gspace.sm,
                        paddingVertical: 3,
                      }}
                    >
                      <GlassText variant="label" tone="white">
                        {waiting} OFFER{waiting > 1 ? 'S' : ''}
                      </GlassText>
                    </View>
                  ) : null}
                  {current ? <GlassIcon name="check" color={p.band} size={22} /> : null}
                </Pressable>
              );
            })}
          </View>
          <GlassText variant="caption" tone="faint" style={{ marginTop: gspace.lg, textAlign: 'center' }}>
            Same login · one duty switch for both
          </GlassText>
        </View>
      </View>
    ) : null
  );
  return null;
}
