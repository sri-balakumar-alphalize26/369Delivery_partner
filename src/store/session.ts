import { create } from 'zustand';
import { api } from '../api/endpoints';
import { getServer, saveServer } from '../api/config';
import { setFeatures } from '../api/features';
import { setSessionExpiredHandler } from '../api/rest/client';
import {
  ApiError,
  CodeRequestResult,
  Currency,
  DutyResult,
  FleetInfo,
  Rider,
  ServerConfig,
  Vehicle,
} from '../api/types';

/**
 * Connection state.
 *
 * A rider signs in with their WhatsApp number: Odoo sends a code there, and
 * the code buys a token the phone keeps in its keystore (`api/rest/auth.ts`).
 * No password, no Odoo user. `me` is the first call after signing in, and
 * again on every launch — it answers "is the token still good" and "is this
 * person actually a rider" together.
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
  /**
   * The vehicle side, when the server has `delivery_fleet_ops`. Undefined
   * means "no fleet here", and every vehicle control stays hidden.
   */
  fleet: FleetInfo | undefined;
  /** False until storage has been read — gates the router. */
  ready: boolean;
  /** True once `me` has succeeded against the current server. */
  connected: boolean;

  restore: () => Promise<void>;
  /** Saves the config and asks Odoo to send `cfg.login` a sign-in code on WhatsApp. */
  sendCode: (cfg: ServerConfig) => Promise<CodeRequestResult>;
  /**
   * Signs in with the code from WhatsApp and verifies it with `me`. Demo mode
   * takes no code. Throws if the server rejects it.
   */
  connect: (cfg: ServerConfig, code: string) => Promise<Rider>;
  /** Folds a duty response back in, so no round-trip to `me` is needed. */
  applyDuty: (result: DutyResult) => void;
  /** The vehicle in hand after a mid-shift swap. */
  applyVehicle: (vehicle: Vehicle | null) => void;
  /**
   * Ask `me` again, quietly. What the office switches in Delivery Settings —
   * fuel logs, the door photo — reaches a phone that is already open, not
   * only the next time the app starts. A failure changes nothing.
   */
  refresh: () => Promise<void>;
  /** The server no longer knows this session. The Gate then lands on Connect. */
  expire: () => void;
  disconnect: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  server: null,
  rider: null,
  timezone: undefined,
  currency: undefined,
  fleet: undefined,
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
      const { rider, timezone, currency, fleet } = await api.me();
      set({ rider, timezone, currency, fleet, connected: true });
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

  async sendCode(cfg) {
    const server = await saveServer(cfg);
    set({ server });
    try {
      return await api.requestCode(server.login);
    } catch (err) {
      console.warn(
        '[login] code request failed:',
        err instanceof ApiError ? `${err.code} — ${err.message}` : (err as Error)?.message
      );
      throw err instanceof ApiError
        ? err
        : new ApiError('unknown', 'Could not ask for a sign-in code.');
    }
  },

  async connect(cfg, code) {
    const server = await saveServer(cfg);
    set({ server });

    try {
      if (!server.useMock) await api.verifyCode(server.login, code);
      const { rider, timezone, currency, fleet } = await api.me();
      set({ rider, timezone, currency, fleet, connected: true });
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
            // Only a fleet server answers with `vehicle`; leave the rest alone.
            ...(s.fleet && result.vehicle !== undefined
              ? { fleet: { ...s.fleet, vehicle: result.vehicle } }
              : {}),
          }
        : {}
    );
  },

  async refresh() {
    if (!useSession.getState().connected) return;
    try {
      const { rider, timezone, currency, fleet } = await api.me();
      set({ rider, timezone, currency, fleet });
    } catch {
      // Offline, or the session ended — the latter is handled by the expiry
      // path in the client. Keep what we have.
    }
  },

  applyVehicle(vehicle) {
    set((s) => (s.fleet ? { fleet: { ...s.fleet, vehicle } } : {}));
  },

  expire() {
    console.warn('[login] session ended by the server, back to Connect');
    set({ rider: null, connected: false });
  },

  async disconnect() {
    console.log('[login] signing out');
    // Server side first, while the token can still authenticate the call; the
    // tokens are dropped either way. The address, database and number stay
    // saved: none of them is a secret, and typing them again is what Connect
    // exists to avoid.
    await api.logout();
    set({
      rider: null,
      timezone: undefined,
      currency: undefined,
      fleet: undefined,
      connected: false,
    });
  },
}));

// A call the server refused because the session is gone ends the session here
// too, so the Gate sends the rider to Connect instead of leaving them on a
// screen whose every request fails.
setSessionExpiredHandler(() => useSession.getState().expire());

// The adapters ask `hasFeature` before sending a parameter an older server
// would reject; keep its list in step with whatever `me` said last.
useSession.subscribe((s) => setFeatures(s.fleet?.features));
