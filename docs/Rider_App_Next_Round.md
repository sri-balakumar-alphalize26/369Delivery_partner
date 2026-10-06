# Rider App: next round of changes

5 October 2026 · 369 Delivery Partner app · server `sales_automation_delivery` 19.0.22.5.0 on DUBAI_TEST

---

## In short

| # | What | Who builds it |
|---|------|---------------|
| 1 | "Packed" pressed before the customer pays: wait 1 minute, no error popup | Senior (Odoo) |
| 2 | **Resend code** in the customer-code box | Our app + Senior |
| 3 | **"Delivered, thank you"** for the rider, and a thank-you WhatsApp for the customer | Our app + Senior |
| 4 | Sign-in asks **Office rider** or **Delivery Partner** | Our app + Senior |
| – | Earnings for the two kinds | Already built. No change. |

---

## 1. "Packed" before the customer has paid

**The problem.** When an order comes in, the shop often taps **"Packed – call the rider"** at once.
If the customer hasn't paid yet, Odoo shows an error popup and nothing happens.

**What we want.**
- The shop can press **Packed** even if payment hasn't landed yet. The order stays packed.
- The order card shows **"Waiting for payment · 1:00"**, counting down.
- If the payment arrives within that minute, the rider is called **by itself**.
- If it's still unpaid after a minute, the card shows a calm note ("Not paid yet — the rider will be
  called when the customer pays"), never an error popup.
- The 1 minute is a setting the admin can change in Delivery Settings.

**Our app:** nothing to change.

---

## 2. Resend the customer code

**The problem.** At the door the customer is waiting, but the WhatsApp code doesn't arrive.
Once a job is "Reached", the rider has no way to ask for another code.

**What the rider sees.**
- Under the six code boxes: **"Didn't get it? Resend code"**.
- After pressing it: "New code sent to •••• 0133", and the link turns into **"Resend in 0:59"**
  until the wait is over.
- Any digits already typed are cleared, because the old code stops working.

**Our app (built now).** Until the senior's new route exists, the app asks for a fresh code the way
it already can (it calls "Reached" again, which sends a new code).

**Senior (asked).** A proper resend that tells the app whether WhatsApp really sent it, how long to
wait before the next one, and keeps a limit per job.

---

## 3. Thank you after delivery

**For the rider (our app).** The order of steps at the door becomes:

1. Customer code
2. 2 to 4 delivery photos
3. **"Delivered — thank you, bala!"** screen: big green tick, order number, customer name, time
   delivered, and the trip pay for Delivery Partners
4. Back to jobs: by the button, or by itself after 8 seconds

**For the customer (senior).** A WhatsApp from the shop after delivery:
*"Your order S00042 was delivered at 17:39 by bala. Thank you for shopping with us."*
An optional rating link. If a delivered message already exists, the senior confirms its text.

---

## 4. Sign-in asks the role

**Today.** Everyone signs in the same way: phone number, then a WhatsApp code. The office sets each
rider as **Own Rider** or **Delivery Partner** in Odoo.

**What we want.** The same phone and code, but first the rider picks:

| Office rider | Delivery Partner |
|---|---|
| Staff of the shop, on salary | Paid per delivery |

- One must be picked before **Send code** works. The phone remembers the last choice.
- If the choice doesn't match what the office set, sign-in stops with a clear message:
  *"This number is registered as a Delivery Partner. Choose Delivery Partner and sign in again."*
- **Our app** checks this after sign-in for now and signs the rider out on a mismatch.
- **Senior (asked):** check it **before** sending the WhatsApp code, so no code goes out for the
  wrong role.
- Demo mode: the choice decides which kind the demo rider is, to show both Earnings views.

---

## Earnings (no change)

Already in place on both sides, so it stays as it is:

- **Office rider:** deliveries done, time on duty, cash carried. No money.
- **Delivery Partner:** pay today, this week, this month and all time, worked out by the server.
- **Admin settings in Odoo** (Delivery Settings): pay per job, kilometres included, pay per km,
  Express bonus, and the switch "Use third-party riders". Pay can also be typed by hand on one job.

Note: on DUBAI_TEST all rates are **0**, and both riders (bala, "Rider app test") are **Own Rider**,
so no one sees pay there yet.

---

## What gets delivered

1. **App changes** for items 2, 3 and 4.
2. **A colour explainer page for the senior** (same style as "Keep the customer's address": colour
   per owner, Today vs Ask, plain words first) with the asks for items 1 to 4.

---

## Technical reference

### Our app

| Item | Files | Notes |
|---|---|---|
| Resend code | `src/ui/CodeSheet.tsx`, `app/(app)/order/[id].tsx`, `src/api/types.ts`, `src/api/rest/adapter.ts`, `src/api/mock/adapter.ts` | New `api.resendCustomerCode(id)`; falls back to `POST /api/delivery/arrived {point:"customer"}`. New optional `onResend` / `resendIn` props on `CodeSheet`; the pickup code box doesn't use them. Wait = server's `retry_after`, else 60 s. |
| Thank-you screen | new `app/(app)/done/[id].tsx`, `app/(app)/_layout.tsx`, `app/(app)/photos/[id].tsx`, `src/photos/owed.ts` | Registered like `photos/[id]` (no tab bar). `leave()` on the delivery stage goes here, not Home. Data from the photo entry (`ref`, `customerName`, new optional `fee`); nothing fetched. |
| Role at sign-in | `app/connect.tsx`, `src/store/session.ts`, `src/api/rest/*` | Send `kind: "own" \| "third_party"` with `auth/request-code` and `auth/verify-code`. After sign-in compare with `rider.kind` from `/auth/me`; mismatch → sign out + message. Choice stored on the phone. |

### Asks to the senior

1. **Packed before payment:** accept `sa_shop_ready` while unpaid; `packed_waiting_payment` state
   with a deadline (Delivery Settings, default 60 s); payment within it calls the rider; after it,
   a notice on the card, no `UserError` popup.
2. **Resend:** `POST /api/delivery/customer-code/resend {delivery_order_id}` →
   `200 {sent: true, sent_to: "•••0133", retry_after: 60}` or `{sent: false, reason:
   "whatsapp_failed" | "too_soon" | "limit"}`. The old code stops working. Limit per job (e.g. 5).
   Each resend in the job log.
3. **Thank-you WhatsApp** after Delivered: order number, time, rider name; optional rating link.
4. **Role check:** `auth/request-code` and `auth/verify-code` read `kind`; mismatch → `403
   {code: "wrong_kind", registered_kind, message}` before any code is sent. No `kind` (older app) →
   as today.

### How it is checked

- `npx tsc --noEmit` and lint on the changed files.
- On the tablet, nothing real sent: the Resend line and countdown in the code box, the thank-you
  screen with test values, both role cards and the mismatch message (demo mode).
  Screenshots to `screenshots/resend_and_thanks/` and `screenshots/role_login/`.
- Live on DUBAI_TEST, with your OK: one delivery end to end (resend once, code, photos, thank-you).
