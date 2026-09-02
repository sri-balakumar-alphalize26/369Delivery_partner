# 369 Delivery Partner

The rider app for 369Delivery. Riders go on duty, receive orders, pick up from the
store, and deliver with an OTP.

- **Stack:** React Native + Expo **SDK 54**, TypeScript, Expo Router
- **Package:** `com.alphalize.deliverypartner`
- **Backend:** none yet — the app ships with a full in-memory simulation

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
src/api/mock/adapter.ts    in-memory simulation   (default)
src/api/real/adapter.ts    REST over HTTP         (for Odoo)
```

Switch with environment variables — no screen code changes:

```bash
EXPO_PUBLIC_API_MODE=real
EXPO_PUBLIC_API_URL=https://your-odoo-host
```

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

Odoo login and integration, document-upload onboarding, embedded maps, order
batching, wallet and payouts, COD reconciliation, shift slots, support chat,
ratings and penalties, iOS build, multi-language.

The adapter interface, the `RiderConfig` object and the order status machine are
built so these drop in without restructuring. `RiderConfig` in particular lets
one app serve dark-store, food and courier models — the backend sends
`assignmentMode`, `canReject`, `proofType` and the UI adapts.
