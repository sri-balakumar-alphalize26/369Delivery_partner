import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { peekServer } from '../api/config';
import { request } from '../api/rest/client';
import { ApiError } from '../api/types';

/**
 * Crashes on a rider's phone, sent to our own server.
 *
 * Before this, a crash showed the rider the crash screen and nobody else ever
 * heard of it. Now each one is kept on the phone first (a crash can end the app
 * a moment later, and a rider is often out of signal) and sent to
 * `POST /api/delivery/app/crash` the next time the app is signed in and online,
 * where the office sees it next to the rider.
 *
 * Two sources: a screen that throws (the root `ErrorBoundary`) and any error
 * nothing else caught (React Native's global handler). Demo mode keeps
 * nothing: there is no server to tell.
 *
 * A server without the route answers 404; the reports then stay queued until
 * it has one. The queue keeps the newest 20.
 */

export interface CrashReport {
  /** When it happened, UTC. */
  at: string;
  message: string;
  /** Trimmed to 4000 characters. */
  stack: string;
  /** `screen`: a screen threw. `global`: nothing caught it. */
  source: 'screen' | 'global';
  fatal: boolean;
  /** The screen's route when known, e.g. `/order/1234`. */
  route?: string;
  app_version: string;
  os: string;
  device: string;
}

const KEY = 'd369.crashes';
const KEEP = 20;
const STACK_MAX = 4000;
const ROUTE = '/api/delivery/app/crash';

let lastRoute: string | undefined;
/** The screen the rider is on, set by the root layout, so a report says where. */
export function noteRoute(route: string): void {
  lastRoute = route;
}

function device(): string {
  const c = Platform.constants as { Brand?: string; Model?: string } | undefined;
  return [c?.Brand, c?.Model].filter(Boolean).join(' ') || Platform.OS;
}

function build(error: unknown, source: CrashReport['source'], fatal: boolean): CrashReport {
  const e = error instanceof Error ? error : new Error(String(error));
  return {
    at: new Date().toISOString(),
    message: (e.message || e.name || 'Unknown error').slice(0, 500),
    stack: (e.stack ?? '').slice(0, STACK_MAX),
    source,
    fatal,
    route: lastRoute,
    app_version: Constants.expoConfig?.version ?? 'unknown',
    os: `${Platform.OS} ${String(Platform.Version)}`,
    device: device(),
  };
}

async function load(): Promise<CrashReport[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CrashReport[]) : [];
  } catch {
    return [];
  }
}

async function save(list: CrashReport[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(-KEEP))).catch(() => {});
}

/** Keep one crash on the phone, then try to send what is waiting. Never throws. */
export async function reportCrash(
  error: unknown,
  source: CrashReport['source'],
  fatal = false
): Promise<void> {
  try {
    if (peekServer().useMock) return;
    const list = await load();
    list.push(build(error, source, fatal));
    await save(list);
    void flushCrashes();
  } catch {
    // Reporting a crash must never cause one.
  }
}

let flushing = false;

/**
 * Send what is waiting, all in one call. Only while signed in: the server files
 * a report under the rider whose token sent it. Kept on any failure.
 */
export async function flushCrashes(): Promise<void> {
  if (flushing || peekServer().useMock) return;
  flushing = true;
  try {
    const list = await load();
    if (!list.length) return;
    await request(ROUTE, { method: 'POST', body: { reports: list } });
    // Only what was sent goes; a crash that came in meanwhile stays.
    const now = await load();
    await save(now.slice(list.length));
    console.log(`[crash] sent ${list.length} report(s)`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      console.log('[crash] this server has no crash route yet; reports kept');
    }
  } finally {
    flushing = false;
  }
}

/**
 * Catch what nothing else did. Installed once, at start-up; the handler that
 * was there before (the red screen in development, the native crash in a
 * release) still runs after ours.
 */
export function installCrashHandler(): void {
  const eu = (globalThis as { ErrorUtils?: {
    getGlobalHandler: () => (e: unknown, fatal?: boolean) => void;
    setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void;
  } }).ErrorUtils;
  if (!eu) return;
  const previous = eu.getGlobalHandler();
  eu.setGlobalHandler((error, fatal) => {
    void reportCrash(error, 'global', !!fatal);
    previous(error, fatal);
  });
}
