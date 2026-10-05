import { openCamera } from './CameraSheet';

/**
 * One photo from the camera, small enough to send over a rider's connection.
 *
 * The camera is our own sheet (`CameraSheet`), not the phone's camera app:
 * leaving for that app let Android close this one, and the photo was lost.
 * Quality 0.5 and no editing - a parcel or a fuel receipt needs to be legible,
 * not beautiful. `base64` is filled only when a caller asks (the vehicle logs
 * still send it); the parcel photos go up as files.
 *
 * The reason for no photo is in `error`, so the screen can say something true.
 */
export async function takePhoto(
  opts: { base64?: boolean } = {}
): Promise<{ base64: string; uri: string } | { error: 'denied' | 'cancelled' | 'failed' }> {
  return openCamera(!!opts.base64);
}

export function photoProblem(error: 'denied' | 'cancelled' | 'failed'): string | null {
  if (error === 'denied') return 'Camera not allowed. Allow it in Settings to take the photo.';
  if (error === 'failed') return 'The camera did not open. Try again.';
  return null; // Backing out is not a problem worth a message.
}
