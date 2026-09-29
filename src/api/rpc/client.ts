import { getServer } from '../config';
import { Action, ApiError, ApiErrorCode, DeliveryStatus } from '../types';

/**
 * JSON-RPC transport to the Odoo module `delivery_rider_rpc`.
 *
 * The app signs in the way every Odoo client does — POST /web/session/authenticate
 * with the database, the rider's number and their password — and from then on
 * calls one model, `sa.rider.rpc`, through /web/dataset/call_kw. Odoo answers the
 * sign-in with a session cookie. The phone's native cookie jar keeps it across
 * restarts, so the app itself stores no credential at all.
 *
 * Three things here are contract requirements, not preferences:
 *
 *   1. The database is named ONLY in the sign-in call. Odoo 19 refuses an
 *      `X-Odoo-Database` header sent alongside the session cookie with a 403,
 *      and a header on the sign-in call marks the session stateless, so no
 *      cookie would ever be set. (odoo/http.py, _get_session_and_dbname)
 *   2. A business refusal is a normal result — `{success: false, code, message,
 *      status, allowed_actions}` — and Odoo's own errors (not signed in, or
 *      signed in but not a rider) arrive as a JSON-RPC `error` with HTTP 200.
 *      The HTTP status says nothing; only the envelope does.
 *   3. `message` is written for the rider. It is shown unchanged.
 */

const MODEL = 'sa.rider.rpc';
const DEFAULT_TIMEOUT_MS = 20000;

interface RpcError {
  code: number;
  message: string;
  data?: { name?: string; message?: string; arguments?: unknown[] };
}

interface Envelope<T> {
  jsonrpc: '2.0';
  id: number | null;
  result?: T;
  error?: RpcError;
}

/** The module saying no: a result, not an error. */
interface Refusal {
  success: false;
  code?: string;
  message?: string;
  status?: DeliveryStatus;
  allowed_actions?: Action[];
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
];

function toCode(raw: unknown): ApiErrorCode {
  return KNOWN_CODES.includes(raw as ApiErrorCode) ? (raw as ApiErrorCode) : 'unknown';
}

/** A v4 uuid, for the `client_uuid` the module de-duplicates taps by. */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Odoo's names for "you are not signed in any more". */
const EXPIRED = new Set(['odoo.http.SessionExpiredException', 'odoo.exceptions.AccessDenied']);
const EXPIRED_MESSAGE = 'Your sign-in has expired. Sign in again.';

let onExpired: (() => void) | null = null;

/**
 * Called for every call the server refuses because the session is gone, so the
 * session store can send the rider back to Connect instead of leaving them on
 * a screen whose every request fails.
 */
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  onExpired = fn;
}

let nextId = 1;

function serverMessage(error: RpcError, fallback: string): string {
  return error.data?.message || error.message || fallback;
}

async function requireServer() {
  const server = await getServer();
  if (!server.url) {
    throw new ApiError('network', 'No server address set. Open Connect and enter one.');
  }
  return server;
}

/** One JSON-RPC round trip. Returns the envelope; the caller reads `result` or `error`. */
async function post<T>(
  url: string,
  path: string,
  params: Record<string, unknown>,
  timeoutMs: number
): Promise<Envelope<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      // The session cookie is the credential — make sure it travels both ways.
      credentials: 'include',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: nextId++, params }),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('network', 'Could not reach the server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  // A dead tunnel or a wrong address answers with an HTML page, never JSON.
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError('unknown', `Unexpected response from the server (${res.status}).`, {
      status: res.status,
    });
  }

  try {
    return (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError('unknown', 'The server sent a response the app could not read.', {
      status: res.status,
    });
  }
}

/**
 * The databases a server offers, for the Connect screen to pick from. Takes the
 * address as typed, since nothing is saved until the rider signs in.
 *
 * `null` means the server will not say — `list_db = False` in odoo.conf answers
 * with a JSON-RPC error — and the rider has to type the name. No cookie is
 * involved, so this cannot disturb a session.
 */
export async function listDatabases(rawUrl: string): Promise<string[] | null> {
  const url = rawUrl.trim().replace(/\/+$/, '');
  if (!url) return null;
  console.log(`[login] listing databases at ${url}`);
  let envelope: Envelope<string[]>;
  try {
    envelope = await post<string[]>(url, '/web/database/list', {}, 8000);
  } catch (err) {
    console.warn(`[login] database list failed at ${url}:`, (err as Error)?.message);
    throw err;
  }
  if (envelope.error || !Array.isArray(envelope.result)) {
    console.warn(
      '[login] server will not list its databases:',
      envelope.error?.data?.name ?? envelope.error?.message ?? 'no list in the answer'
    );
    return null;
  }
  console.log(`[login] ${envelope.result.length} database(s):`, envelope.result.join(', '));
  return envelope.result;
}

/**
 * Sign in. On success Odoo has set the session cookie; nothing is returned
 * because nothing needs keeping.
 *
 * Every outcome is logged under `[login]` — the server, database and username,
 * never the password — so a failed sign-in on a rider's phone can be read out
 * of `adb logcat` rather than guessed at from the message on screen.
 */
export async function login(username: string, password: string): Promise<void> {
  const { url, db } = await requireServer();
  if (!db) {
    console.warn('[login] no database chosen');
    throw new ApiError('no_database', 'No database set. Open Connect and enter one.');
  }

  console.log(`[login] signing in as "${username}" to ${db} at ${url}`);
  const started = Date.now();
  let envelope: Envelope<{ uid?: number | null }>;
  try {
    envelope = await post<{ uid?: number | null }>(
      url,
      '/web/session/authenticate',
      { db, login: username, password },
      DEFAULT_TIMEOUT_MS
    );
  } catch (err) {
    console.warn(
      `[login] request failed after ${Date.now() - started}ms:`,
      (err as Error)?.message
    );
    throw err;
  }

  if (envelope.error) {
    const name = envelope.error.data?.name ?? '';
    const message = serverMessage(envelope.error, '');
    console.warn(
      `[login] refused after ${Date.now() - started}ms: ${name || 'no error name'} — ${message}`
    );
    if (name === 'odoo.exceptions.AccessDenied') {
      throw new ApiError('unauthorized', 'Wrong username or password.');
    }
    // "Database not found." from Odoo, or Postgres saying it does not exist.
    if (/database/i.test(message) && /not found|does not exist/i.test(message)) {
      throw new ApiError(
        'no_database',
        'The server did not recognise the database. Check the database name on the Connect screen.'
      );
    }
    throw new ApiError('unknown', message || 'Could not sign in.');
  }

  // Odoo answers {uid: null} when the account needs a second factor.
  if (!envelope.result?.uid) {
    console.warn('[login] signed in but no uid — the account needs two-step sign-in');
    throw new ApiError(
      'unauthorized',
      'This account needs two-step sign-in, which the app does not support. Ask the office.'
    );
  }
  console.log(`[login] signed in, uid ${envelope.result.uid} (${Date.now() - started}ms)`);
}

/** End the session on the server. Best effort: signing out must never be blocked. */
export async function logout(): Promise<void> {
  try {
    const { url } = await getServer();
    if (!url) return;
    await post(url, '/web/session/destroy', {}, 5000);
    console.log('[login] signed out on the server');
  } catch (err) {
    // Already gone, or no signal. Either way the rider is signed out here.
    console.warn('[login] server sign-out failed, signed out here anyway:', (err as Error)?.message);
  }
}

export interface CallOptions {
  timeoutMs?: number;
  /**
   * Return a `success: false` result instead of throwing it. For the one
   * answer that is an instruction rather than a failure: "tracking is over,
   * stop", which arrives as a refusal.
   */
  allowRefusal?: boolean;
}

/** Call one method of `sa.rider.rpc` with keyword arguments. */
export async function call<T>(
  method: string,
  kwargs: Record<string, unknown> = {},
  opts: CallOptions = {}
): Promise<T> {
  const { url } = await requireServer();

  const envelope = await post<T | Refusal>(
    url,
    `/web/dataset/call_kw/${MODEL}/${method}`,
    { model: MODEL, method, args: [], kwargs },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  if (envelope.error) {
    const name = envelope.error.data?.name ?? '';
    if (EXPIRED.has(name)) {
      console.warn(`[login] session expired (${name}) on ${method}`);
      onExpired?.();
      throw new ApiError('unauthorized', EXPIRED_MESSAGE);
    }
    // Signed in, but the user is not linked to a rider. The module explains how to fix it.
    if (name === 'odoo.exceptions.AccessError') {
      console.warn(`[login] signed in but not a rider (${method}):`, serverMessage(envelope.error, ''));
      throw new ApiError(
        'unauthorized',
        serverMessage(envelope.error, 'This login is not linked to a rider.')
      );
    }
    throw new ApiError('unknown', serverMessage(envelope.error, 'The server refused the request.'));
  }

  const result = envelope.result;
  if (isRefusal(result) && !opts.allowRefusal) {
    throw new ApiError(toCode(result.code), result.message ?? 'The server refused this.', {
      statusName: result.status,
      allowedActions: result.allowed_actions,
    });
  }
  return result as T;
}

function isRefusal(value: unknown): value is Refusal {
  return !!value && typeof value === 'object' && (value as Refusal).success === false;
}
