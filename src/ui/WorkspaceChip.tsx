import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useWorkload } from '../hooks/useWorkload';
import { useSession } from '../store/session';
import { glass, gspace } from '../theme/glass';
import { paletteFor, WORKSPACE_LABEL } from '../theme/workspace';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';
import { WorkspaceSheet } from './WorkspaceSheet';

/**
 * "DELIVERY ▾" under the name on a band header, for someone the office set to
 * work in both lines. Tapping it opens the switch sheet. A red number on it
 * means an offer is waiting on the other side.
 *
 * Draws nothing for someone in one line only: there is nothing to switch to.
 */
export function WorkspaceChip() {
  const { lines, workspace } = useSession();
  const { offers } = useWorkload();
  const [open, setOpen] = useState(false);
  if (lines.length < 2) return null;

  const p = paletteFor(workspace);
  const other = lines.find((l) => l !== workspace);
  const waiting = other ? offers[other] : 0;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${WORKSPACE_LABEL[workspace]} open. Switch workspace${waiting ? `, ${waiting} offer waiting on ${WORKSPACE_LABEL[other!]}` : ''}`}
        hitSlop={8}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 4,
          marginTop: gspace.xs,
          paddingVertical: 4,
          paddingHorizontal: gspace.md,
          borderRadius: 999,
          backgroundColor: p.accent,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <GlassText variant="label" style={{ color: p.accentInk }}>
          {WORKSPACE_LABEL[workspace].toUpperCase()}
        </GlassText>
        <GlassIcon name="chevDown" size={14} color={p.accentInk} />
        {waiting ? (
          <View
            style={{
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              paddingHorizontal: 4,
              backgroundColor: glass.red,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 2,
            }}
          >
            <GlassText variant="label" tone="white" style={{ fontSize: 10 }}>
              {waiting}
            </GlassText>
          </View>
        ) : null}
      </Pressable>
      <WorkspaceSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
