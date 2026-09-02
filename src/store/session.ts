import { create } from 'zustand';
import { api } from '../api/endpoints';
import { clearServer, getServer, saveServer } from '../api/config';
import { ApiError, Rider, ServerConfig } from '../api/types';

/**
 * Connection state.
 *
 * There is no login. The rider is whoever the pasted bearer token says they
 * are, and `/auth/me` is what confirms it — the contract recommends making that
 * the first call after connecting, because it answers "did the credentials
 * work" and "is this person actually a rider" together.
 */
interface SessionState {
  server: ServerConfig | null;
  rider: Rider | null;
  /** False until storage has been read — gates the router. */
  ready: boolean;
  /** True once /auth/me has succeeded against the current server. */
  connected: boolean;

  restore: () => Promise<void>;
  /** Saves the config and verifies it. Throws if the server rejects it. */
  connect: (cfg: ServerConfig) => Promise<Rider>;
  disconnect: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  server: null,
  rider: null,
  ready: false,
  connected: false,

  async restore() {
    const server = await getServer();
    set({ server });

    try {
      const rider = await api.me();
      set({ rider, connected: true });
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
      const rider = await api.me();
      set({ rider, connected: true });
      return rider;
    } catch (err) {
      set({ rider: null, connected: false });
      throw err instanceof ApiError
        ? err
        : new ApiError('unknown', 'Could not verify that connection.');
    }
  },

  async disconnect() {
    await clearServer();
    const server = await getServer();
    set({ server, rider: null, connected: false });
  },
}));
