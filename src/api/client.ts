import { getServer } from './config';
import { Action, ApiError, ApiErrorCode, DeliveryStatus } from './types';

/**
 * HTTP transport for the Odoo Delivery Partner API.
 *
 * Three things here are contract requirements, not preferences:
 *
 *   1. `X-Odoo-Database` on EVERY request. The server hosts 24 databases and has
 *      no dbfilter, so without it every call returns 404 with an HTML body —
 *      not JSON. Verified against the live host.
 *   2. Failures come back as `{"success": false, "message", "code"}` with HTTP
 *      200-or-error. `message` is already written for the rider; we surface it
 *      unchanged rather than inventing our own wording.
 *   3. A `wrong_state` error carries `status_name` and `allowed_actions`, which
 *      is enough to re-render a stale screen without a reload.
 */

interface Envelope {
  success?: boolean;
  message?: string;
  code?: string;
  status_name?: DeliveryStatus;
  allowed_actions?: Action[];
  [k: string]: unknown;
}

const KNOWN_CODES: ApiErrorCode[] = [
  'unauthorized',
  'not_found',
  'wrong_state',
  'bad_otp',
  'otp_required',
];

function toCode(raw: unknown): ApiErrorCode {
  return KNOWN_CODES.includes(raw as ApiErrorCode) ? (raw as ApiErrorCode) : 'unknown';
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  /** Multipart upload (proof photo) — sent instead of `body`. */
  form?: FormData;
  timeoutMs?: number;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { url, db, token } = await getServer();

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
  if (method !== 'GET') headers['Idempotency-Key'] = uuid();
  if (opts.body) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);

  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('network', 'Could not reach the server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  // The missing-database 404 is an HTML page, so never assume the body is JSON.
  const contentType = res.headers.get('content-type') ?? '';
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

  let payload: Envelope;
  try {
    payload = (await res.json()) as Envelope;
  } catch {
    throw new ApiError('unknown', 'The server sent a response the app could not read.', {
      status: res.status,
    });
  }

  if (!res.ok || payload.success === false) {
    throw new ApiError(
      toCode(payload.code),
      // Their wording, verbatim — it is already written for riders.
      payload.message ?? `Request failed (${res.status}).`,
      {
        status: res.status,
        statusName: payload.status_name,
        allowedActions: payload.allowed_actions,
      }
    );
  }

  return payload as unknown as T;
}
