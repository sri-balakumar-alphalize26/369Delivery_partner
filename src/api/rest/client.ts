import { Platform } from 'react-native';
import { getServer } from '../config';
import { syncClock } from '../../lib/clock';
import { Action, ApiError, ApiErrorCode, DeliveryStatus, RiderKind } from '../types';
import { clearTokens, getTokens, saveTokens, Tokens } from './auth';

/**
 * HTTP transport for the Delivery Partner API of `sales_automation_delivery`,
 * under /api/delivery.
 *
 * Contract requirements, not preferences:
 *
 *   1. `X-Odoo-Database` on EVERY request. A server with several databases and
 *      no dbfilter answers a call without it with an HTML 404, not JSON.
 *   2. The rider is the Bearer token from `auth/verify-code` - a mobile number
 *      and a WhatsApp code, no Odoo user and no password. A 401 is answered
 *      once by trading that token at `auth/refresh`; only when Odoo refuses
 *      that is the rider signed out.
 *   3. Failures come back as `{"success": false, "message", "code"}`. `message`
 *      is written for the rider and shown unchanged. A `wrong_state` refusal
 *      also carries the status and `allowed_actions`, enough to redraw a stale
 *      screen without a reload.
 */

const DEFAULT_TIMEOUT_MS = 20000;
const EXPIRED_MESSAGE = 'Your sign-in has expired. Sign in again.';

interface Envelope {
  success?: boolean;
  message?: string;
  code?: string;
  status_name?: DeliveryStatus;
  status?: DeliveryStatus;
  allowed_actions?: unknown;
  [k: string]: unknown;
}

const KNOWN_CODES: ApiErrorCode[] = [
  'unauthorized',
  'not_found',
  'wrong_state',
  'bad_otp',
  'otp_required',
  'bad_point',
  'off_duty',
  'no_file',
  'too_large',
  'no_token',
  'uuid_reused',
  'vehicle_needed',
  'vehicle_unavailable',
  'too_far',
  'no_vehicle',
  'bad_odometer',
  'bad_input',
  'proof_needed',
  'disabled',
  'offer_expired',
  'no_device',
  'bad_request',
  'too_many_photos',
  'wait',
  'handover_waiting',
  'wrong_kind',
];

function toCode(raw: unknown): ApiErrorCode {
  return KNOWN_CODES.includes(raw as ApiErrorCode) ? (raw as ApiErrorCode) : 'unknown';
}

/**
 * The actions the app has a button for - the server's `_SA_FLOW` table.
 *
 * Odoo decides the workflow and the app draws `allowed_actions` and nothing
 * else, so a name added on the server before the app knows it is dropped here
 * rather than drawn as a blank link.
 */
const KNOWN_ACTIONS: readonly Action[] = [
  'accept',
  'decline',
  'arrived_shop',
  'verify_pickup_otp',
  'dispatch',
  'start_delivery',
  'verify_delivery_otp',
  'return_to_shop',
  'confirm_return',
  'report_issue',
  'cancel_handover',
  'verify_handover',
];

export function normaliseActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return [];
  const out: Action[] = [];
  for (const name of raw) {
    if (KNOWN_ACTIONS.includes(name as Action)) {
      if (!out.includes(name as Action)) out.push(name as Action);
    } else {
      console.warn('[api] action the app has no button for:', name);
    }
  }
  return out;
}

/** A v4 uuid, for the `Idempotency-Key` that makes a re-sent tap safe. */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let onExpired: (() => void) | null = null;

/**
 * Called when the server no longer accepts this rider's tokens, so the session
 * store can send them back to Connect instead of leaving them on a screen whose
 * every request fails.
 */
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  onExpired = fn;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  timeoutMs?: number;
  /** No token on this call: the sign-in steps themselves. */
  anonymous?: boolean;
  /**
   * Return a `success: false` answer instead of throwing it. For the one
   * answer that is an instruction rather than a failure: "tracking is over,
   * stop", on a location fix.
   */
  allowRefusal?: boolean;
  /**
   * The Idempotency-Key to send instead of a fresh one. Only the outbox sets
   * it: a queued step keeps the key it was first queued with, so a re-send
   * whose first answer was lost on the way back cannot run the step twice.
   */
  idempotencyKey?: string;
  /**
   * A multipart body instead of JSON — the door photo. It goes by
   * XMLHttpRequest, which writes its own Content-Type with the boundary, so
   * none is set here. Its `timeoutMs` counts from the last byte that moved,
   * not from the start: a big photo on a slow but working signal is not cut off.
   */
  form?: FormData;
  /** For a `form`: bytes gone up so far, of the whole body. */
  onProgress?: (sent: number, total: number) => void;
}

interface Raw {
  status: number;
  payload: Envelope;
}

/**
 * What an <Image> needs to load a server photo such as `/api/delivery/proof/4831`:
 * the full address and the database and token every call carries. A local or
 * full address (the practice server) goes as it is.
 */
export async function imageSource(path: string): Promise<{ uri: string; headers?: Record<string, string> }> {
  if (!path.startsWith('/')) return { uri: path };
  const { url, db } = await getServer();
  const tokens = await getTokens();
  const headers: Record<string, string> = {};
  if (db) headers['X-Odoo-Database'] = db;
  if (tokens?.access) headers.Authorization = `Bearer ${tokens.access}`;
  return { uri: `${url}${path}`, headers };
}

/** One HTTP round trip. Throws only for transport faults; the caller reads the envelope. */
async function send(path: string, opts: RequestOptions, token: string | null, key: string): Promise<Raw> {
  const { url, db } = await getServer();
  if (!url) {
    throw new ApiError('network', 'No server address set. Open Connect and enter one.');
  }
  if (!db) {
    throw new ApiError('no_database', 'No database set. Open Connect and enter one.');
  }

  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Odoo-Database': db,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['Idempotency-Key'] = key;
  if (opts.body && !opts.form) headers['Content-Type'] = 'application/json';

  let reply: Reply;
  if (opts.form) {
    reply = await sendForm(`${url}${path}`, method, headers, opts);
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(`${url}${path}`, {
        method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      reply = {
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        text: await res.text(),
      };
    } catch {
      throw new ApiError('network', 'Could not reach the server. Check your connection.');
    } finally {
      clearTimeout(timer);
    }
  }
  return readReply(reply);
}

interface Reply {
  status: number;
  contentType: string;
  text: string;
}

/**
 * A multipart body by XMLHttpRequest: `fetch` says nothing while it uploads,
 * and a photo bar needs the bytes. Given up only when nothing has moved for
 * `timeoutMs` - the upload, then the server's answer.
 */
function sendForm(
  url: string,
  method: string,
  headers: Record<string, string>,
  opts: RequestOptions
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const idleMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const quiet = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => xhr.abort(), idleMs);
    };
    const fail = () => {
      if (timer) clearTimeout(timer);
      reject(new ApiError('network', 'Could not reach the server. Check your connection.'));
    };

    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      quiet();
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (timer) clearTimeout(timer);
      resolve({
        status: xhr.status,
        contentType: xhr.getResponseHeader('content-type') ?? '',
        text: xhr.responseText,
      });
    };
    xhr.onerror = fail;
    xhr.onabort = fail;
    xhr.ontimeout = fail;
    quiet();
    xhr.send(opts.form);
  });
}

/** The envelope out of an answer, or why there is none. */
function readReply(res: Reply): Raw {
  // A wrong database or a dead tunnel answers with an HTML page, never JSON.
  const contentType = res.contentType;
  if (!contentType.includes('application/json')) {
    if (res.status === 404) {
      throw new ApiError(
        'no_database',
        'The server did not recognise the database. Check the database name on the Connect screen.',
        { status: 404 }
      );
    }
    throw new ApiError('unknown', `Unexpected response from the server (${res.status}).`, {
      status: res.status,
    });
  }

  try {
    return { status: res.status, payload: JSON.parse(res.text) as Envelope };
  } catch {
    throw new ApiError('unknown', 'The server sent a response the app could not read.', {
      status: res.status,
    });
  }
}

function refusal({ status, payload }: Raw): ApiError {
  return new ApiError(
    toCode(payload.code),
    // Their wording, verbatim - it is already written for riders.
    payload.message ?? `Request failed (${status}).`,
    {
      status,
      statusName: payload.status_name ?? payload.status,
      allowedActions:
        payload.allowed_actions === undefined ? undefined : normaliseActions(payload.allowed_actions),
      waitUntil: typeof payload.wait_until === 'string' ? payload.wait_until : undefined,
      registeredKind: isKind(payload.registered_kind) ? payload.registered_kind : undefined,
    }
  );
}

function isKind(raw: unknown): raw is RiderKind {
  return raw === 'own' || raw === 'third_party';
}

function isUnauthorized({ status, payload }: Raw): boolean {
  return status === 401 || payload.code === 'unauthorized';
}

/**
 * Reads the token out of a sign-in or refresh answer: `{success, token,
 * expires_at, rider}`. `access_token` is accepted too, and a separate refresh
 * token is kept if a server ever sends one; the documented API does not.
 */
function readTokens(payload: Envelope, previous?: Tokens | null): Tokens | null {
  const data = (payload.data && typeof payload.data === 'object' ? payload.data : payload) as Envelope;
  const access = data.token ?? data.access_token;
  if (typeof access !== 'string' || !access) return null;
  const refresh = data.refresh_token ?? previous?.refresh;
  return typeof refresh === 'string' && refresh ? { access, refresh } : { access };
}

/**
 * The phone, as Odoo lists the session under Delivery ▸ App Sessions — so the
 * office can tell one rider's tablet from their phone. Sent with sign-in and
 * every refresh.
 */
function deviceName(): string {
  const c = Platform.constants as { Brand?: string; Model?: string } | undefined;
  return [c?.Brand, c?.Model].filter(Boolean).join(' ') || Platform.OS;
}

/**
 * One refresh at a time: every call that met the 401 waits on the same one.
 *
 * `auth/refresh` trades the `refresh_token` from sign-in, and both tokens
 * rotate. The access token goes along too - in the header, and in the body in
 * case an expired one no longer passes the header check. Resolves to the new
 * tokens, or `null` when Odoo refused them - the only proof the session is
 * over. A transport fault rejects instead, so a rider in a dead spot is not
 * signed out.
 */
let refreshing: Promise<Tokens | null> | null = null;

function refreshTokens(previous: Tokens): Promise<Tokens | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const raw = await send(
        '/api/delivery/auth/refresh',
        {
          method: 'POST',
          body: {
            // The contract trades the refresh token; the old access token rides
            // along for a server that predates it.
            ...(previous.refresh ? { refresh_token: previous.refresh } : {}),
            token: previous.access,
            device: deviceName(),
          },
        },
        previous.access,
        uuid()
      );
      if (raw.status >= 400 || raw.payload.success === false) {
        console.warn('[login] refresh refused:', raw.payload.message ?? raw.status);
        return null;
      }
      const next = readTokens(raw.payload, previous);
      if (next) {
        await saveTokens(next);
        console.log('[login] token refreshed');
      }
      return next;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function expireSession(): Promise<never> {
  await clearTokens();
  onExpired?.();
  throw new ApiError('unauthorized', EXPIRED_MESSAGE, { status: 401 });
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const key = opts.idempotencyKey ?? uuid();
  const tokens = opts.anonymous ? null : await getTokens();
  if (!opts.anonymous && !tokens) {
    throw new ApiError('unauthorized', 'Sign in to continue.');
  }

  let raw = await send(path, opts, tokens?.access ?? null, key);

  if (tokens && isUnauthorized(raw)) {
    // A transport fault here propagates as `network`: no signal is not proof
    // the session is over, and the next call will try the refresh again.
    const next = await refreshTokens(tokens);
    if (!next) return expireSession();
    // Same Idempotency-Key: the first attempt was refused before anything ran.
    raw = await send(path, opts, next.access, key);
    if (isUnauthorized(raw)) return expireSession();
  }

  // Every reply that carries the server's clock sets ours, not only the orders
  // poll: the offer countdown reads it, and a poll that stalls left it on the
  // phone's own clock - the test tablet ran two minutes fast and showed a live
  // offer as expired.
  if (typeof raw.payload.server_time === 'string') syncClock(raw.payload.server_time);

  const failed = raw.status >= 400 || raw.payload.success === false;
  if (failed && !(opts.allowRefusal && raw.status < 500 && !isUnauthorized(raw))) {
    throw refusal(raw);
  }
  return raw.payload as unknown as T;
}

/** WhatsApp numbers as the rider record holds them: digits with the country code. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

/** The `mobile` the sign-in calls take, written as the API documents it: +96899887766. */
function mobileOf(phone: string): string {
  return `+${normalisePhone(phone)}`;
}

/**
 * Ask Odoo to send a sign-in code on WhatsApp. The answer is the same for any
 * number, and a code still live (10 minutes) is not sent again.
 */
export async function requestCode(
  phone: string,
  kind?: RiderKind
): Promise<{ message?: string; retry_after_seconds?: number }> {
  const mobile = mobileOf(phone);
  console.log(`[login] asking for a sign-in code for ${mobile}`);
  const r = await request<Envelope>('/api/delivery/auth/request-code', {
    method: 'POST',
    // `kind` lets the server refuse before any code goes out; an older one ignores it.
    body: kind ? { mobile, kind } : { mobile },
    anonymous: true,
  });
  return {
    message: typeof r.message === 'string' ? r.message : undefined,
    retry_after_seconds:
      typeof r.retry_after_seconds === 'number' ? r.retry_after_seconds : undefined,
  };
}

/** Trade the WhatsApp code for the rider's token, and keep it. */
export async function verifyCode(phone: string, code: string, kind?: RiderKind): Promise<void> {
  const mobile = mobileOf(phone);
  const started = Date.now();
  let r: Envelope;
  try {
    r = await request<Envelope>('/api/delivery/auth/verify-code', {
      method: 'POST',
      body: { mobile, code: code.trim(), device: deviceName(), ...(kind ? { kind } : {}) },
      anonymous: true,
    });
  } catch (err) {
    console.warn(
      `[login] code refused after ${Date.now() - started}ms:`,
      err instanceof ApiError ? `${err.code} - ${err.message}` : (err as Error)?.message
    );
    throw err;
  }
  const tokens = readTokens(r);
  if (!tokens) {
    console.warn('[login] code accepted but no token in the answer:', Object.keys(r).join(', '));
    throw new ApiError('unknown', 'The server accepted the code but sent no sign-in token.');
  }
  await saveTokens(tokens);
  console.log(`[login] signed in as ${mobile} (${Date.now() - started}ms)`);
}

/** End the session on the server, then here. Best effort: signing out is never blocked. */
export async function logout(): Promise<void> {
  const tokens = await getTokens();
  try {
    if (tokens) {
      await send('/api/delivery/auth/logout', { method: 'POST', body: {} }, tokens.access, uuid());
      console.log('[login] signed out on the server');
    }
  } catch (err) {
    // Already gone, or no signal. Either way the rider is signed out here.
    console.warn('[login] server sign-out failed, signed out here anyway:', (err as Error)?.message);
  } finally {
    await clearTokens();
  }
}

/**
 * The databases a server offers, for the Connect screen to pick from. Takes the
 * address as typed, since nothing is saved until the rider signs in.
 *
 * Odoo's own JSON-RPC route - the one call here that is not under /api/delivery.
 * `null` means the server will not say (`list_db = False`) and the rider types
 * the name instead.
 */
export async function listDatabases(rawUrl: string): Promise<string[] | null> {
  const url = rawUrl.trim().replace(/\/+$/, '');
  if (!url) return null;
  console.log(`[login] listing databases at ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let envelope: { result?: unknown; error?: { data?: { name?: string }; message?: string } };
  try {
    const res = await fetch(`${url}/web/database/list`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: 1, params: {} }),
      signal: controller.signal,
    });
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
      throw new ApiError('unknown', `Unexpected response from the server (${res.status}).`);
    }
    envelope = await res.json();
  } catch (err) {
    console.warn(`[login] database list failed at ${url}:`, (err as Error)?.message);
    throw err instanceof ApiError
      ? err
      : new ApiError('network', 'Could not reach the server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  if (envelope.error || !Array.isArray(envelope.result)) {
    console.warn(
      '[login] server will not list its databases:',
      envelope.error?.data?.name ?? envelope.error?.message ?? 'no list in the answer'
    );
    return null;
  }
  const dbs = envelope.result.filter((x): x is string => typeof x === 'string');
  console.log(`[login] ${dbs.length} database(s):`, dbs.join(', '));
  return dbs;
}
