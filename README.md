# 369 Delivery Partner

The rider app for 369Delivery. Riders go on duty, receive orders, pick up from the
store, and deliver with an OTP.

- **Stack:** React Native + Expo **SDK 54**, TypeScript, Expo Router
- **Package:** `com.alphalize.deliverypartner`
- **Backend:** Odoo 19 with the `delivery_rider_rpc` module, over Odoo's own JSON-RPC.
  A copy of the module is in [`odoo_modules/delivery_rider_rpc`](odoo_modules/delivery_rider_rpc).
  Demo mode ships a full in-memory simulation.

---

## Run it

Background location and push do **not** work in Expo Go, so this needs a
development build. One-time setup:

```bash
npm install
npx expo install --fix          # keeps native versions matched to SDK 54

npm install -g eas-cli
eas login
eas build --profile development --platform android
```

Install the resulting APK on a real Android phone, then:

```bash
npx expo start --dev-client
```

### Demo mode

With no server connected the app runs against `src/api/mock/`:

| | |
|---|---|
| Login | any phone + any password |
| Delivery code | **5678** |
| First order | arrives ~8 seconds after going on duty |

**Profile → Demo controls** has switches to force the two failure paths that
matter: *another rider takes the order*, and *no internet*.

---

## Connecting the real backend

The app talks to exactly one interface, `ApiAdapter` in
[`src/api/types.ts`](src/api/types.ts). Two implementations satisfy it:

```
src/api/mock/adapter.ts    in-memory simulation                 (default)
src/api/rest/adapter.ts    REST to the Delivery Partner API     (/api/delivery/*)
```

The live adapter talks to the WhatsApp delivery module's own rider API
(`sales_automation_delivery`), the same server actions as the buttons on
Odoo's job form ([`src/api/rest/client.ts`](src/api/rest/client.ts)). Every
call carries `X-Odoo-Database` and the rider's Bearer token.

The contract is the senior's *Rider_App_Developer_Plan.pdf* (rev 2, served
from `/sales_automation_manual/static/manual/`; *Delivery_Developer_Flow.pdf*
section 3 before it). `/api/sa/*` in *Full_Flow_API.pdf* is the shop/admin
app's API, not this one's.

A rider signs in with the WhatsApp number on their rider record (Delivery →
Configuration → Riders & Couriers): `auth/request-code {mobile}` sends a
6-digit code on WhatsApp, `auth/verify-code {mobile, code}` trades it for a
`token`, kept in the phone's keystore. A 401 is answered once by trading that
token at `auth/refresh`. No Odoo user or password is involved.

The steps follow the shop's Step-by-Step Guide:

```
accept → pickup/verify-otp → dispatch   Collect (one tap: "Collected by Rider")
       → start                          I am near the customer
       → arrived {point: "customer"}    Reached - Odoo sends the customer their code
       → complete/verify-otp            the customer's code: Delivered
```

`arrived` is never in `allowed_actions` - Odoo offers the code from "near" on -
so the job screen shows "Reached" itself until the code has been sent.

Before those steps, and around them:

- **Duty.** Clocking on sends the phone's position with `POST /duty`; Home
  shows the area Odoo names it (`address_short`). While on duty the app sends
  `POST /rider/location` at the server's pace (`poll_after_seconds`: 2 min
  waiting, 30 s with a job) - the shop's "Call a Rider" ranks riders by it.
- **Offers.** One rider at a time, with a time limit: the offer screen counts
  down to `offer_expires_at` against the server's clock. **Decline** asks an
  optional reason (`POST /decline`); the next rider is called at once. An
  Accept that comes too late gets `offer_expired`, and the app says so.
- **Live tracking.** From Accept until Delivered the app sends
  `POST /location {delivery_order_id, latitude, longitude, accuracy}` at the
  pace each reply sets (20 s on the way, 10 s near the customer) and stops on
  `stop: true`. That is the dot on the customer's tracking page and the shop's
  Live Tracking.

`scripts/live-check.mjs` checks the live shapes against the app's parsers:
`send-code <phone>` first, then `check <format.js> --phone <phone> --code <code>`.

Switch with environment variables — no screen code changes:

```bash
EXPO_PUBLIC_API_MODE=real
EXPO_PUBLIC_API_URL=https://your-odoo-host
EXPO_PUBLIC_ODOO_DB=your-database
```

The address and database can also be changed in the app (Profile → Change
connection), and the sign-in happens there.

Because both adapters are typed against `ApiAdapter`, any drift between the app
and the backend contract is a **compile error**, not a bug on a rider's phone.

---

## Design

"Big Type + Status Colour". The rules live in
[`src/theme/tokens.ts`](src/theme/tokens.ts) and are worth keeping:

- **No cards, no shadows, no borders, no gradients.** Separation is whitespace
  and hairlines. This is what keeps it from looking like every other delivery app.
- **Hierarchy comes from type size**, never from boxes.
- **One piece of colour per screen** — the status bar at the top, whose colour
  tells the rider their state from three metres away:

| State | Colour |
|---|---|
| Off duty | Grey |
| Waiting | Near-black |
| New order | Brand orange `#FE5901` |
| Go to store | Brand blue `#0042B3` |
| Delivering | Green |

Brand colours are sampled from the supplied logo. Orange only reaches 3.4:1
against white, so the offer screen uses near-black text on orange — never white.

Fonts are Archivo with tabular figures, so money and countdowns don't jitter as
digits change.

---

## Icons and splash

Icon assets are generated from the brand artwork:

```bash
py scripts/build_icons.py
```

`ICON_SOURCE` at the top of that script controls what the icon shows:

| Value | Result |
|---|---|
| `"full"` *(current)* | the whole illustration — wordmark, tagline, rider, skyline |
| `"mark"` | just the "369" + orange swoosh |

The full illustration is the current choice. Be aware that at 48 dp — the real
size on a home screen — the tagline and rider are not legible, and Android's
circular mask shrinks it further. `"mark"` stays readable at that size. Either
way the script sizes the Android foreground to provably fit inside the circular
safe zone (see `safe_coverage`), so nothing is ever cropped off.

### Splash

**Android 12+ will not render a full-screen splash image.** The platform forces
a centred icon on a solid colour, so a portrait illustration set as the native
splash gets cropped to nothing.

So there are two splashes, and the handoff between them is seamless:

1. **Native** — a centred mark on `#F3F7FE`, visible for a fraction of a second
   while the JS engine boots. This is all the OS allows.
2. **In-app** — [`src/ui/SplashArt.tsx`](src/ui/SplashArt.tsx) renders the full
   portrait artwork edge to edge while fonts and the session load, held for a
   minimum of 1.2s so it reads as branding rather than a flash.

`resizeMode="cover"` fills every phone aspect. The artwork is 16:9 and modern
phones are up to 20:9, so the sides are trimmed — verified that only empty
background is lost, the wordmark and rider survive intact on 16:9, 19.5:9 and
20:9.

---

## Not built yet (deliberate)

Document-upload onboarding, embedded maps, order batching, wallet and payouts, COD reconciliation, shift slots, support chat,
ratings and penalties, iOS build, multi-language.

The adapter interface, the `RiderConfig` object and the order status machine are
built so these drop in without restructuring. `RiderConfig` in particular lets
one app serve dark-store, food and courier models — the backend sends
`assignmentMode`, `canReject`, `proofType` and the UI adapts.
