import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/api/endpoints';
import { ApiError, VehicleIssueCategory } from '../../src/api/types';
import { useSession } from '../../src/store/session';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../src/theme/glass';
import { Field } from '../../src/ui/Field';
import { GlassButton } from '../../src/ui/glass/GlassButton';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassHeader } from '../../src/ui/glass/GlassHeader';
import { GlassIcon } from '../../src/ui/glass/GlassIcon';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';
import { photoProblem, takePhoto } from '../../src/ui/takePhoto';

/**
 * The bike the rider has out: log fuel, report a problem.
 *
 * Fleetbase's driver app does both; here they land in Odoo Fleet's own
 * service log against the vehicle in hand, where the office already looks
 * after servicing. "I can't ride it" grounds the vehicle: it stays with this
 * rider until they clock off, and is offered to nobody after that until the
 * office clears it.
 */

const ISSUES: { code: VehicleIssueCategory; label: string }[] = [
  { code: 'flat_tyre', label: 'Flat tyre' },
  { code: 'breakdown', label: 'Breakdown' },
  { code: 'accident', label: 'Accident' },
  { code: 'other', label: 'Other' },
];

function num(text: string): number | undefined {
  const n = parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function VehicleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const vehicle = useSession((s) => s.fleet?.vehicle ?? null);
  const applyVehicle = useSession((s) => s.applyVehicle);

  return (
    <GlassScreen>
      <GlassHeader title="My vehicle" onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: gspace.xl,
            paddingBottom: gspace.xxxl + insets.bottom,
            width: '100%',
            maxWidth: CONTENT_MAX_W,
            alignSelf: 'center',
          }}
          keyboardShouldPersistTaps="handled"
        >
          <GlassCard>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <GlassIcon
                name={vehicle?.type === 'car' ? 'car' : 'bike'}
                color={glass.inkSoft}
                size={28}
                style={{ marginRight: gspace.md }}
              />
              <View style={{ flex: 1 }}>
                <GlassText variant="subtitle">
                  {vehicle ? vehicle.plate || vehicle.name : 'No vehicle'}
                </GlassText>
                <GlassText variant="caption" tone="soft">
                  {vehicle
                    ? [vehicle.brand, vehicle.model].filter(Boolean).join(' ') +
                      (vehicle.grounded ? ' · marked not rideable' : '')
                    : 'Pick one on Home when you go on duty.'}
                </GlassText>
              </View>
            </View>
          </GlassCard>

          {vehicle ? (
            <>
              <FuelCard />
              <IssueCard onGrounded={() => applyVehicle({ ...vehicle, grounded: true })} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </GlassScreen>
  );
}

function PhotoRow({
  uri,
  onTake,
  label,
}: {
  uri: string | null;
  onTake: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onTake}
      accessibilityRole="button"
      accessibilityLabel={uri ? `Retake ${label}` : `Add ${label}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: gspace.lg,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: 48, height: 48, borderRadius: 8, marginRight: gspace.md }}
          contentFit="cover"
        />
      ) : (
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 8,
            marginRight: gspace.md,
            backgroundColor: glass.fill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GlassIcon name="eye" color={glass.inkSoft} size={20} />
        </View>
      )}
      <GlassText variant="body" tone="indigo">
        {uri ? `Retake ${label}` : `Add ${label} (optional)`}
      </GlassText>
    </Pressable>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(work: () => Promise<{ message?: string }>, done: () => void) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await work();
      setMessage(res.message ?? 'Saved.');
      done();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, error, setError, submit };
}

function FuelCard() {
  const [liters, setLiters] = useState('');
  const [amount, setAmount] = useState('');
  const [odometer, setOdometer] = useState('');
  const [photo, setPhoto] = useState<{ base64: string; uri: string } | null>(null);
  const { busy, message, error, setError, submit } = useSubmit();

  async function shoot() {
    const shot = await takePhoto();
    if ('error' in shot) return setError(photoProblem(shot.error));
    setPhoto(shot);
  }

  return (
    <GlassCard style={{ marginTop: gspace.lg }}>
      <GlassText variant="label" tone="soft" upper style={{ marginBottom: gspace.lg }}>
        Log fuel
      </GlassText>
      <Field label="Litres" keyboardType="decimal-pad" value={liters} onChangeText={setLiters} />
      <Field label="Amount paid" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      <Field
        label="Odometer (km)"
        keyboardType="number-pad"
        value={odometer}
        onChangeText={setOdometer}
      />
      <PhotoRow uri={photo?.uri ?? null} onTake={shoot} label="receipt photo" />
      <GlassButton
        title="Save fuel"
        kind="dark"
        icon="check"
        loading={busy}
        disabled={!num(liters)}
        onPress={() =>
          submit(
            () =>
              api.fuelReport({
                liters: num(liters)!,
                amount: num(amount),
                odometer: num(odometer),
                photoBase64: photo?.base64,
              }),
            () => {
              setLiters('');
              setAmount('');
              setOdometer('');
              setPhoto(null);
            }
          )
        }
      />
      <Outcome message={message} error={error} />
    </GlassCard>
  );
}

function IssueCard({ onGrounded }: { onGrounded: () => void }) {
  const [category, setCategory] = useState<VehicleIssueCategory>('flat_tyre');
  const [note, setNote] = useState('');
  const [grounded, setGrounded] = useState(false);
  const [photo, setPhoto] = useState<{ base64: string; uri: string } | null>(null);
  const { busy, message, error, setError, submit } = useSubmit();

  async function shoot() {
    const shot = await takePhoto();
    if ('error' in shot) return setError(photoProblem(shot.error));
    setPhoto(shot);
  }

  return (
    <GlassCard style={{ marginTop: gspace.lg }}>
      <GlassText variant="label" tone="soft" upper style={{ marginBottom: gspace.md }}>
        Report a problem
      </GlassText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gspace.sm, marginBottom: gspace.lg }}>
        {ISSUES.map((it) => {
          const on = it.code === category;
          return (
            <Pressable
              key={it.code}
              onPress={() => setCategory(it.code)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={{
                paddingVertical: gspace.sm,
                paddingHorizontal: gspace.md,
                borderRadius: gradius.chip,
                borderWidth: 1,
                borderColor: on ? glass.indigo : glass.border,
                backgroundColor: on ? glass.indigo : glass.fill,
              }}
            >
              <GlassText variant="body" style={{ color: on ? glass.white : glass.ink }}>
                {it.label}
              </GlassText>
            </Pressable>
          );
        })}
      </View>
      <Field label="What happened" value={note} onChangeText={setNote} multiline />
      <PhotoRow uri={photo?.uri ?? null} onTake={shoot} label="photo" />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: gspace.lg }}>
        <View style={{ flex: 1, paddingRight: gspace.md }}>
          <GlassText variant="bodyStrong">I can't ride it</GlassText>
          <GlassText variant="caption" tone="soft">
            The office is told, and it is not given to anyone until fixed.
          </GlassText>
        </View>
        <Switch
          value={grounded}
          onValueChange={setGrounded}
          trackColor={{ true: glass.orange, false: glass.dividerDashed }}
          thumbColor={glass.white}
        />
      </View>
      <GlassButton
        title="Send report"
        kind={grounded ? 'orange' : 'dark'}
        icon="alert"
        loading={busy}
        onPress={() =>
          submit(
            () =>
              api.vehicleIssue({ category, note: note.trim(), photoBase64: photo?.base64, grounded }),
            () => {
              if (grounded) onGrounded();
              setNote('');
              setPhoto(null);
              setGrounded(false);
            }
          )
        }
      />
      <Outcome message={message} error={error} />
    </GlassCard>
  );
}

function Outcome({ message, error }: { message: string | null; error: string | null }) {
  if (error) {
    return (
      <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.md }}>
        {error}
      </GlassText>
    );
  }
  if (message) {
    return (
      <GlassText variant="bodyStrong" tone="green" style={{ marginTop: gspace.md }}>
        {message}
      </GlassText>
    );
  }
  return null;
}
