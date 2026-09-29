# delivery_rider_rpc: the rider app over plain Odoo JSON-RPC

The rider app talks to Odoo and to nothing else. Odoo moves the delivery job
and sends the WhatsApp messages.

```
App ──JSON-RPC──► sa.rider.rpc ──► stock.picking.sa_set_state()   (the same method as the backend buttons)
                                     │ stock validated, COD settled, WhatsApp messages composed
                                     ▼
                                   sa.rider.outbox  ──cron (seconds later)──► WhatsApp gateway ──► customer / group / shop
                                                                        └────► Expo push       ──► rider's phone
```

- **Depends on** `sales_automation_delivery` only. Nothing in `sales_automation_*` is edited.
- **Other callers are unchanged.** `/api/delivery/*`, the backend buttons and the WhatsApp flow behave exactly as before.

## Signing in

```http
POST /web/session/authenticate
{"jsonrpc":"2.0","method":"call","params":{"db":"sparenix_test","login":"96890003333","password":"…"}}
```

- Keep the `session_id` cookie and send it on every call.
- Naming the database in this call replaces the `X-Odoo-Database` header.

**Giving a rider a login:** in Delivery, go to Configuration → Riders, open the rider and press **Create app login**.
- This creates a *portal* user whose login is the rider's number. A portal user cannot open the backend.
- The button then opens Odoo's Change Password dialog.
- An existing user can be linked through the **App Login** field instead.

## Calling

```http
POST /web/dataset/call_kw
{"jsonrpc":"2.0","method":"call","params":{
  "model":"sa.rider.rpc","method":"accept","args":[],"kwargs":{"job_id":42,"client_uuid":"…"}}}
```

Every method returns a dict.

- **A business refusal is a normal result.** Example: `{"success":false,"code":"wrong_state","status":"offered","allowed_actions":["accept"]}`. Redraw the buttons from it.
- **Only these raise**, and they arrive as a JSON-RPC `error`:
  - not signed in (`SessionExpired`: sign in again);
  - signed in, but the user is not a rider (`AccessError`).

| method | kwargs | returns (besides `success`) |
|---|---|---|
| `me` | – | `rider{id,name,mobile,kind,on_duty,duty_since}`, `timezone`, `currency`, `server_time` |
| `orders` | – | `counts{assigned,picked_up,out_for_delivery,delivered}`, `orders[]`, `on_duty`, `timezone`, `server_time` |
| `order` | `job_id` | `order{…full job…}` |
| `history` | `limit=20, offset=0` | `history[]`, `total` |
| `set_duty` | `on_duty, client_uuid?` | `on_duty`, `duty_since`, `jobs_picked_up`, `message` |
| `rider_location` | `latitude, longitude, battery?` | `poll_after_seconds`, `has_new_offer` (`off_duty` when clocked off) |
| `accept` | `job_id, client_uuid?` | step answer |
| `arrived` | `job_id, point='shop'\|'customer', client_uuid?` | step answer + `otp_sent`, `arrived_at` |
| `request_pickup_otp` | `job_id` | step answer + `otp_sent`, `retry_after_seconds` |
| `verify_pickup` | `job_id, otp, client_uuid?` | step answer |
| `dispatch` / `start` | `job_id, client_uuid?` | step answer |
| `verify_delivery` | `job_id, otp, client_uuid?` | step answer + `delivered_at` |
| `return_to_shop` | `job_id, reason, client_uuid?` | step answer |
| `confirm_return` | `job_id, client_uuid?` | step answer |
| `report_issue` | `job_id, reason, client_uuid?` | step answer |
| `ping` | `job_id, latitude, longitude, accuracy?` | `stop` (true = switch GPS off) |
| `ping_batch` | `job_id, points[{latitude,longitude,accuracy}]` | `stop`, `stored` |
| `upload_proof` | `job_id, image_base64, filename?` | `attachment_id` |
| `register_push` / `unregister_push` | `token, platform?` | – |

**A step answer** is `{success, status, allowed_actions, tracking{enabled}, message}`.

**The job fields** are the same as those the `/api/delivery` API sends: `delivery_order_id`, `job_code`, `customer_*`, `shop{…}`, `products[]`, `payment_status`, `amount_to_collect`, `currency`, `delivery_status`, `delivery_type`, `promised_by`, `allowed_actions`, and, in `order`, `latitude`, `longitude`, `tracking` and `timestamps`.
- All times are UTC with a trailing `Z`.
- `order` returns the job only nested under `order`.

**Refusal codes:** `not_found`, `wrong_state`, `bad_otp`, `bad_point`, `off_duty`, `no_file`, `too_large`, `no_token`, `uuid_reused`.

With **Return OTPs in the API** switched on in Delivery Settings (testing only), the answers also carry `otp_debug`.

## Offline and replays

- **Send a fresh `client_uuid` with every tap.** When the app re-sends a queued action, the first call to land does the work, and the later ones get the same answer back with `replayed: true`. Only successful answers are remembered, so a wrong code can be retried under the same uuid. A uuid that was already used for a different action or job is refused with `uuid_reused`; it is never answered with the other job's result.
- **Codes need signal.** `verify_pickup` and `verify_delivery` check a live code, so queue them only as "waiting for signal".
- **Buffered GPS** goes in one `ping_batch` call.

## WhatsApp: when it is sent, and what happens when it fails

- **When.** A rider's step queues its messages in `sa.rider.outbox` in the same transaction as the step. The outbox cron (triggered immediately and also run every minute) sends them in order.
  - A step that rolls back leaves nothing queued.
  - The messages for one delivery never overtake each other.
- **What is queued.** The exact call the delivery module would have made, whatever it is: a text to the customer, a message said in the WhatsApp group, the pickup code to the shop, or a message to the rider. Every override has already decided where the message goes before it is queued. That includes the store module's group chat and the 369 Mart bridge's silence for website orders.

**What happens on each outcome:**

| Outcome | State | What happens next |
|---|---|---|
| Sent | `sent` | Nothing. Rows are kept for 30 days. |
| Gateway not connected | `handed_off` | The gateway keeps the message as *pending* and retries it itself. We do not send it again. |
| Refused by policy (opt-out, daily cap), or WhatsApp switched off | `blocked` | Not retried. |
| Any other error | `queued` | Retried after 1, 2, 5 and 15 minutes. On the 5th failure the row becomes `failed` and a note is posted on the delivery. |

**Where to look:** Delivery → Rider App Messages lists everything that is `failed` or `blocked`, each with a **Retry** button.

**Push notifications (Expo)** go to the rider's registered phones when a job is offered to them, and when it is cancelled or turned round by somebody else. A token Expo reports as unregistered is switched off. Every push names the app's `jobs` Android channel, the one it creates at full importance, so the banner shows.

## Tests

```powershell
& "C:\Program Files\Odoo 19.0.20260119\python\python.exe" odoo-bin -c odoo.conf -d <db> -u delivery_rider_rpc `
  --test-enable --test-tags=/delivery_rider_rpc --stop-after-init --http-port=8211 --gevent-port=8212 --max-cron-threads=0
```

- Run it from PowerShell. Git Bash mangles `--test-tags`.
- The gateway is mocked at `_send_payload` and Expo at `_expo_post`. No network is used.
