import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { EmergencyContact, getContacts, MAX_CONTACTS, saveContacts } from '../lib/emergencyContacts';
import { gspace } from '../theme/glass';
import { Field } from './Field';
import { GlassButton } from './glass/GlassButton';
import { GlassCard } from './glass/GlassCard';
import { GlassText } from './glass/GlassText';

/**
 * Profile: up to two people who get a WhatsApp with the rider's location when
 * SOS is held. Kept on this phone.
 */
export function EmergencyContactsCard() {
  const [list, setList] = useState<EmergencyContact[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getContacts().then((c) =>
      setList([...c, ...Array.from({ length: MAX_CONTACTS - c.length }, () => ({ name: '', phone: '' }))])
    );
  }, []);

  const set = (i: number, key: keyof EmergencyContact, value: string) => {
    setSaved(false);
    setList((l) => l.map((c, j) => (j === i ? { ...c, [key]: value } : c)));
  };

  return (
    <GlassCard style={{ marginTop: gspace.lg }}>
      <GlassText variant="label" tone="soft" upper>
        Emergency contacts
      </GlassText>
      <GlassText variant="caption" tone="soft" style={{ marginTop: gspace.xs, marginBottom: gspace.md }}>
        When you hold SOS, they get a WhatsApp with where you are. Number with the country code.
      </GlassText>
      {list.map((c, i) => (
        <View key={i} style={{ marginBottom: gspace.sm }}>
          <Field
            label={`Contact ${i + 1} name`}
            icon="user"
            value={c.name}
            onChangeText={(v) => set(i, 'name', v)}
            placeholder="e.g. Brother"
          />
          <Field
            label={`Contact ${i + 1} WhatsApp number`}
            icon="phone"
            value={c.phone}
            onChangeText={(v) => set(i, 'phone', v)}
            keyboardType="phone-pad"
            placeholder="e.g. 971 50 123 4567"
          />
        </View>
      ))}
      <GlassButton
        title={saved ? 'Saved' : 'Save contacts'}
        kind={saved ? 'ghost' : 'green'}
        icon="check"
        onPress={async () => {
          await saveContacts(list);
          setSaved(true);
        }}
      />
    </GlassCard>
  );
}
