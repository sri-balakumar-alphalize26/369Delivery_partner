import { create } from 'zustand';
import { api } from '../api/endpoints';
import { getServer, saveServer } from '../api/config';
import { setFeatures } from '../api/features';
import { setSessionExpiredHandler } from '../api/rest/client';
import { getSavedWorkspace, pickWorkspace, saveWorkspace } from '../lib/workspace';
import {
  ApiError,
  AutoNearCustomer,
  CodeRequestResult,
  Currency,
  DutyResult,
  FleetInfo,
  Rider,
  ServerConfig,
  Vehicle,
  WorkLine,
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
 *
 * Nothing about the person is chosen on the phone. The office sets both on
 * the rider record in Odoo: Kind (office staff or partner - pay) comes back on
 * `rider`, and Works In (Delivery, Service or both) from `partnerMe` as
 * `lines`. A hybrid agent's open side is `workspace`.
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
  /**
   * What the rider API offers beyond the fleet block — `location`,
   * `track_from_accept` — from `me.features`. Empty on an older server.
   */
  features: string[];
  /** When the server marks "near the customer" by itself; undefined on an older server. */
  autoNear: AutoNearCustomer | undefined;
  /** Where the rider clocked on, as the server named it ("al Azaiba, Muscat"). */
  area: string | undefined;
  /** False until storage has been read — gates the router. */
  ready: boolean;
  /** True once `me` has succeeded against the current server. */
  connected: boolean;
  /**
   * The lines this person works in, as the office set "Works In". Delivery
   * only until `partnerMe` says otherwise, and on a server without it.
   */
  lines: WorkLine[];
  /** The side open now. Always one of `lines`. */
  workspace: WorkLine;

  restore: () => Promise<void>;
  /** Saves the config and asks Odoo to send `cfg.login` a sign-in code on WhatsApp. */
  sendCode: (cfg: ServerConfig) => Promise<CodeRequestResult>;
  /**
   * Signs in with the code from WhatsApp and verifies it with `me`. Demo mode
   * takes no code. Throws if the server rejects it.
   */
  connect: (cfg: ServerConfig, code: string) => Promise<Rider>;
  /** Open the other side, for someone who works in both. Ignored otherwise. */
  setWorkspace: (ws: WorkLine) => void;
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

/**
 * Ask which lines this person works in, and open the side they had last if
 * they still work in it. A failure (no signal) keeps what was known.
 */
async function loadLines(set: (s: Partial<SessionState>) => void): Promise<void> {
  try {
    const info = await api.partnerMe();
    const workspace = pickWorkspace(info.lines, await getSavedWorkspace());
    set({ lines: info.lines, workspace });
    console.log(`[login] works in: ${info.lines.join(' + ')}, opening ${workspace}`);
  } catch (err) {
    console.log('[login] works-in check failed, keeping what we had:', (err as Error)?.message);
  }
}

export const useSession = create<SessionState>((set, get) => ({
  server: null,
  rider: null,
  timezone: undefined,
  currency: undefined,
  fleet: undefined,
  features: [],
  autoNear: undefined,
  area: undefined,
  ready: false,
  connected: false,
  lines: ['delivery'],
  workspace: 'delivery',

  async restore() {
    const server = await getServer();
    set({ server });
    console.log(
      server.useMock
        ? '[login] launch: demo mode'
        : `[login] launch: checking saved session for "${server.login}" on ${server.db} at ${server.url}`
    );

    try {
      const { rider, timezone, currency, fleet, features, auto_near_customer } =
        await api.me();
      // Lines before `connected`: a notification tap held since the app opened
      // is routed the moment `connected` turns true, and must find the right side.
      await loadLines(set);
      set({
        rider,
        timezone,
        currency,
        fleet,
        features: features ?? [],
        autoNear: auto_near_customer,
        connected: true,
      });
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
      const { rider, timezone, currency, fleet, features, auto_near_customer } =
        await api.me();
      // Lines before `connected`, so the first screen drawn is the right side.
      await loadLines(set);
      set({
        rider,
        timezone,
        currency,
        fleet,
        features: features ?? [],
        autoNear: auto_near_customer,
        connected: true,
      });
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
            area: result.on_duty ? result.address_short || s.area : undefined,
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
      const { rider, timezone, currency, fleet, features, auto_near_customer } =
        await api.me();
      set({
        rider,
        timezone,
        currency,
        fleet,
        features: features ?? [],
        autoNear: auto_near_customer,
      });
    } catch {
      // Offline, or the session ended — the latter is handled by the expiry
      // path in the client. Keep what we have.
      return;
    }
    // The office may have changed "Works In" since the app last looked.
    await loadLines(set);
  },

  setWorkspace(ws) {
    if (!get().lines.includes(ws) || get().workspace === ws) return;
    set({ workspace: ws });
    void saveWorkspace(ws);
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
      features: [],
      autoNear: undefined,
      area: undefined,
      connected: false,
      lines: ['delivery'],
      workspace: 'delivery',
    });
  },
}));

/**
 * The company's time zone, for naming photos: `/auth/me`'s `timezone`. When
 * it is not loaded yet, `me` is asked again rather than the phone's zone used.
 * Throws when the server cannot be reached - the photo could not go up then
 * anyway.
 */
export async function shopTimeZone(): Promise<string> {
  const now = useSession.getState().timezone;
  if (now) return now;
  await useSession.getState().refresh();
  const after = useSession.getState().timezone;
  if (after) return after;
  throw new ApiError('network', "Couldn't get the shop's time zone from the server. Try again.");
}

// A call the server refused because the session is gone ends the session here
// too, so the Gate sends the rider to Connect instead of leaving them on a
// screen whose every request fails.
setSessionExpiredHandler(() => useSession.getState().expire());

// The adapters ask `hasFeature` before sending a parameter an older server
// would reject; keep its list in step with whatever `me` said last.
useSession.subscribe((s) => setFeatures([...(s.fleet?.features ?? []), ...s.features]));
