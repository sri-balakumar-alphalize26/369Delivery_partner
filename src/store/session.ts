import { create } from 'zustand';
import { api } from '../api/endpoints';
import { clearServer, getServer, saveServer } from '../api/config';
import { ApiError, Currency, DutyResult, Rider, ServerConfig } from '../api/types';

/**
 * Connection state.
 *
 * There is no login. The rider is whoever the pasted bearer token says they
 * are, and `/auth/me` is what confirms it — the contract recommends making that
 * the first call after connecting, because it answers "did the credentials
 * work" and "is this person actually a rider" together.
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
  /** True once /auth/me has succeeded against the current server. */
  connected: boolean;

  restore: () => Promise<void>;
  /** Saves the config and verifies it. Throws if the server rejects it. */
  connect: (cfg: ServerConfig) => Promise<Rider>;
  /** Folds a /duty response back in, so no round-trip to /auth/me is needed. */
  applyDuty: (result: DutyResult) => void;
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

    try {
      const { rider, timezone, currency } = await api.me();
      set({ rider, timezone, currency, connected: true });
    } catch {
      // Unset, expired or revoked — land on Connect rather than a broken home
      // screen. Not an error worth showing on launch.
      set({ rider: null, connected: false });
    } finally {
      set({ ready: true });
    }
  },

  async connect(cfg) {
    const server = await saveServer(cfg);
    set({ server });

    try {
      const { rider, timezone, currency } = await api.me();
      set({ rider, timezone, currency, connected: true });
      return rider;
    } catch (err) {
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

  async disconnect() {
    await clearServer();
    const server = await getServer();
    set({ server, rider: null, timezone: undefined, currency: undefined, connected: false });
  },
}));
