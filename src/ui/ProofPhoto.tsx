import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '../api/endpoints';
import { ApiError } from '../api/types';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';
import { GlassText } from './glass/GlassText';
import { photoProblem, takePhoto } from './takePhoto';

/** Jobs whose photo went up this session, so leaving and coming back keeps it. */
const sent = new Map<number, string>();

export function proofSent(orderId: number): boolean {
  return sent.has(orderId);
}

/**
 * The parcel at the door, on the handover step.
 *
 * Fleetbase's proof of delivery. The server has kept `upload_proof` since the
 * first rider module; the app never called it. When Delivery Settings make the
 * photo required, the delivery code is refused until one is in — so the
 * button says so, and the screen holds "Confirm delivery" back.
 */
export function ProofPhoto({
  orderId,
  required,
  onSent,
}: {
  orderId: number;
  required: boolean;
  onSent: () => void;
}) {
  const [uri, setUri] = useState<string | null>(sent.get(orderId) ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function shoot() {
    setError(null);
    const shot = await takePhoto();
    if ('error' in shot) {
      setError(photoProblem(shot.error));
      return;
    }
    setBusy(true);
    try {
      await api.uploadProof(orderId, shot.base64);
      sent.set(orderId, shot.uri);
      setUri(shot.uri);
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The photo did not send. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        marginTop: gspace.lg,
        padding: gspace.lg,
        borderRadius: gradius.chip,
        backgroundColor: glass.bg,
        borderWidth: 1,
        borderColor: required && !uri ? glass.orangeLine : glass.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: 56, height: 56, borderRadius: 10, marginRight: gspace.md }}
            contentFit="cover"
          />
        ) : null}
        <View style={{ flex: 1 }}>
          <GlassText variant="label" tone={uri ? 'green' : required ? 'orange' : 'soft'} upper>
            {uri ? 'Photo sent' : required ? 'Photo needed' : 'Photo at the door'}
          </GlassText>
          <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
            {uri
              ? 'The office can see where you left the parcel.'
              : required
                ? 'Take a photo of the parcel before asking for the code.'
                : 'Optional — shows where you left the parcel.'}
          </GlassText>
        </View>
      </View>
      <GlassButton
        title={uri ? 'Retake photo' : 'Take photo'}
        kind={uri ? 'ghost' : required ? 'orange' : 'ghost'}
        size="sm"
        onPress={shoot}
        loading={busy}
        style={{ marginTop: gspace.md }}
      />
      {error ? (
        <GlassText variant="caption" tone="red" style={{ marginTop: gspace.sm }}>
          {error}
        </GlassText>
      ) : null}
    </View>
  );
}
