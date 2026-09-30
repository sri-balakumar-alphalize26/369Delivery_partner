import * as ImagePicker from 'expo-image-picker';

/**
 * One photo from the camera, small enough to send over a rider's connection.
 *
 * Quality 0.5 and no editing: a parcel on a doorstep or a fuel receipt needs to
 * be legible, not beautiful, and JSON-RPC carries it as base64 — a full-size
 * phone photo would be several megabytes of text on a 3G link.
 *
 * Resolves to null when the rider backs out or refuses the camera; the reason
 * is in `error` so the screen can say something true.
 */
export async function takePhoto(): Promise<
  { base64: string; uri: string } | { error: 'denied' | 'cancelled' | 'failed' }
> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { error: 'denied' };
    const shot = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      base64: true,
      allowsEditing: false,
      exif: false,
    });
    if (shot.canceled || !shot.assets?.[0]?.base64) return { error: 'cancelled' };
    return { base64: shot.assets[0].base64, uri: shot.assets[0].uri };
  } catch {
    return { error: 'failed' };
  }
}

export function photoProblem(error: 'denied' | 'cancelled' | 'failed'): string | null {
  if (error === 'denied') return 'Camera not allowed. Allow it in Settings to take the photo.';
  if (error === 'failed') return 'The camera did not open. Try again.';
  return null; // Backing out is not a problem worth a message.
}
