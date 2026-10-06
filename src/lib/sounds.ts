import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

/**
 * The app's own sounds, so a rider knows it is this app without looking - the
 * way a Snapchat or LinkedIn sound is known. Made for this app (a two-note
 * rising chime, under a second), so no licence to track.
 *
 * Plays while the app is running. With the app closed, the same file rings
 * through the `trip-updates` notification channel instead (src/push/register.ts),
 * which needs it built into the APK.
 */

let nearCustomer: AudioPlayer | null = null;
let newJob: AudioPlayer | null = null;

/**
 * A job offered with the app open: "di-di-DING" twice, looped until
 * `stopNewJob`. The offer alert stops it with the buzz.
 */
export function playNewJob(): void {
  if (Platform.OS === 'web') return;
  try {
    newJob ??= createAudioPlayer(require('../../assets/sounds/new_job.wav'));
    newJob.loop = true;
    newJob.seekTo(0);
    newJob.play();
  } catch {
    // The buzz still says it.
  }
}

export function stopNewJob(): void {
  try {
    newJob?.pause();
  } catch {
    // Nothing playing.
  }
}

/** "Marked near the customer" - the server did it from the rider's position. */
export function playNearCustomer(): void {
  if (Platform.OS === 'web') return;
  try {
    nearCustomer ??= createAudioPlayer(require('../../assets/sounds/near_customer.wav'));
    nearCustomer.seekTo(0);
    nearCustomer.play();
  } catch {
    // A sound is a nicety: the buzz and the banner still say it.
  }
}

/*
 * Short feedback sounds (scripts/make-sounds.js). One player each, made on
 * first use; a failure to play is never worth more than a skipped sound.
 */
const once: Record<string, AudioPlayer | null> = {};

function playOnce(key: string, source: number): void {
  if (Platform.OS === 'web') return;
  try {
    once[key] ??= createAudioPlayer(source);
    once[key]!.seekTo(0);
    once[key]!.play();
  } catch {
    // The buzz still says it.
  }
}

/** Delivered, or a code accepted: two rising notes. */
export function playSuccess(): void {
  playOnce('success', require('../../assets/sounds/success.wav'));
}

/** A wrong code: two low buzzes. */
export function playWrong(): void {
  playOnce('wrong', require('../../assets/sounds/wrong.wav'));
}

/** A job cancelled or taken by another rider: one falling tone. */
export function playJobGone(): void {
  playOnce('gone', require('../../assets/sounds/job_gone.wav'));
}
