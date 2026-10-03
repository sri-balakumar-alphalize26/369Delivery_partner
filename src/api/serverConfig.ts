import { ServerConfig } from './types';

/**
 * How the build's defaults and what the phone saved combine into the server
 * the app talks to. Pure, so the flow test can check it without a phone.
 *
 * Normally a saved value beats the build: the test host is a quick tunnel whose
 * address changes, and Connect is where the new one is typed. A locked build —
 * the one riders install — turns that round for everything that says WHERE the
 * app talks: the address, the database, demo mode, the support number and the
 * route key come from the build and nothing saved can move them. Otherwise a
 * phone that once pointed at a test server would go on pointing there after
 * installing the real app over it. The rider's own number still comes from
 * what was saved, so they are not asked for it again.
 */

export function normaliseServer(cfg: ServerConfig): ServerConfig {
  return {
    // A trailing slash would produce `//api/delivery/...` and a confusing 404.
    url: cfg.url.trim().replace(/\/+$/, ''),
    db: cfg.db.trim(),
    // Absent from a config saved when the app still pasted a token.
    login: cfg.login?.trim() ?? '',
    // Optional and absent from every config saved before it existed.
    supportPhone: cfg.supportPhone?.trim() ?? '',
    orsKey: cfg.orsKey?.trim() ?? '',
    useMock: cfg.useMock,
  };
}

export function resolveServer(
  fromBuild: ServerConfig,
  saved: Partial<ServerConfig> | null,
  locked: boolean
): ServerConfig {
  const merged: ServerConfig = { ...fromBuild, ...(saved ?? {}) };
  if (locked) {
    merged.url = fromBuild.url;
    merged.db = fromBuild.db;
    merged.useMock = false;
    merged.supportPhone = fromBuild.supportPhone;
    merged.orsKey = fromBuild.orsKey;
  }
  return normaliseServer(merged);
}
