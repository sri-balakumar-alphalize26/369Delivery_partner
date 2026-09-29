import { create } from 'zustand';
import { api } from '../api/endpoints';
import { getServer, saveServer } from '../api/config';
import { setSessionExpiredHandler } from '../api/rpc/client';
import { ApiError, Currency, DutyResult, Rider, ServerConfig } from '../api/types';

/**
 * Connection state.
 *
 * A rider signs in with their mobile number and the password the office set
 * with "Create app login" on their rider record in Odoo. The server answers with
 * a session cookie the phone keeps; the app stores no credential. `me` is the
 * first call after signing in, and again on every launch — it answers "is the
 * session still good" and "is this person actually a rider" together.
 *
 * That same response carries the `timezone` and `currency` every screen formats
 * with, so they are held here rather than guessed at per screen.
 */
interface SessionState {
  server: ServerConfig | null;
  rider: Rider | null;
  /** The shop's zone, not the phone's. Times are meaningless without it. */
  timezone: string | undefined;
  currency: Currency | undefined;
  /** False until storage has been read — gates the router. */
  ready: boolean;
  /** True once `me` has succeeded against the current server. */
  connected: boolean;

  restore: () => Promise<void>;
  /** Saves the config, signs in and verifies it. Throws if the server rejects it. */
  connect: (cfg: ServerConfig, password: string) => Promise<Rider>;
  /** Folds a duty response back in, so no round-trip to `me` is needed. */
  applyDuty: (result: DutyResult) => void;
  /** The server no longer knows this session. The Gate then lands on Connect. */
  expire: () => void;
  disconnect: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  server: null,
  rider: null,
  timezone: undefined,
  currency: undefined,
  ready: false,
  connected: false,

  async restore() {
    const server = await getServer();
    set({ server });
    console.log(
      server.useMock
        ? '[login] launch: demo mode'
        : `[login] launch: checking saved session for "${server.login}" on ${server.db} at ${server.url}`
    );

    try {
      const { rider, timezone, currency } = await api.me();
      set({ rider, timezone, currency, connected: true });
      console.log(`[login] launch: session good, rider ${rider.name} (#${rider.id})`);
    } catch (err) {
      // No session yet, or an expired one — land on Connect rather than a
      // broken home screen. Not an error worth showing on launch.
      console.log('[login] launch: no usable session, going to Connect:', (err as Error)?.message);
      set({ rider: null, connected: false });
    } finally {
      set({ ready: true });
    }
  },

  async connect(cfg, password) {
    const server = await saveServer(cfg);
    set({ server });

    try {
      await api.login(server.login, password);
      const { rider, timezone, currency } = await api.me();
      set({ rider, timezone, currency, connected: true });
      console.log(
        `[login] connected${server.useMock ? ' (demo)' : ''}: rider ${rider.name} (#${rider.id}), ` +
          `timezone ${timezone ?? 'unset'}, currency ${currency?.code ?? 'unset'}`
      );
      return rider;
    } catch (err) {
      console.warn(
        '[login] connect failed:',
        err instanceof ApiError ? `${err.code} — ${err.message}` : (err as Error)?.message
      );
      set({ rider: null, connected: false });
      throw err instanceof ApiError
        ? err
        : new ApiError('unknown', 'Could not verify that connection.');
    }
  },

  applyDuty(result) {
    set((s) =>
      s.rider
        ? {
            rider: {
              ...s.rider,
              on_duty: result.on_duty,
              duty_since: result.duty_since,
            },
          }
        : {}
    );
  },

  expire() {
    console.warn('[login] session ended by the server, back to Connect');
    set({ rider: null, connected: false });
  },

  async disconnect() {
    console.log('[login] signing out');
    // Server side first, while the cookie can still authenticate the call. The
    // address, database and number stay saved: none of them is a secret, and
    // typing the tunnel address again is what this screen exists to avoid.
    await api.logout();
    set({ rider: null, timezone: undefined, currency: undefined, connected: false });
  },
}));

// A call the server refused because the session is gone ends the session here
// too, so the Gate sends the rider to Connect instead of leaving them on a
// screen whose every request fails.
setSessionExpiredHandler(() => useSession.getState().expire());
