# Delivery Fleet Ops

Fleet management for the rider app, built on Odoo's own **Fleet** app. The ideas come from Fleetbase Fleet-Ops. None of its code is used: Fleetbase is AGPL-3.0.

Depends on `delivery_rider_rpc` and `fleet`. It edits neither of them, nor any `sales_automation_*` or 369 Mart module. Uninstalling it puts clocking on back as it was.

## Phase 1: vehicles

**In the office**
- Delivery → Fleet → Rider Vehicles lists Fleet's vehicles marked **Rider Vehicle**. New ones are marked automatically.
- **Ridden By** shows who has a vehicle out now.
- **Grounded** keeps a vehicle out of the app until it is cleared.
- On a rider's form:
  - **Riding** is the vehicle in hand now.
  - **Usual Vehicle** is preselected in the app.
- Delivery Settings → **Vehicle Required**: a rider cannot clock on in the app without a vehicle.
- Taking a vehicle makes the rider Fleet's **Driver**, so Fleet's Drivers History records who rode what.
  - The last driver's history line is closed on the same day.
  - Fleet's "Specify the End date" to-do is not created for these changes.
- Delivery managers become Fleet officers so the menu opens.

**For the app** (`sa.rider.rpc`)

| Call | What it does |
|---|---|
| `me` | Adds `fleet: {vehicle, default_vehicle_id, vehicle_required, features}`. Absent without this module. |
| `vehicles()` | Lists the vehicles free for this rider, plus `preselect_id`. |
| `set_duty(on_duty, client_uuid, vehicle_id=None)` | Clocking on takes the named vehicle. With none named, it takes the one already in hand, else the usual one. Clocking off gives it back. Refusals: `vehicle_needed`, `vehicle_unavailable`. |
| `take_vehicle(vehicle_id, client_uuid)` | Swaps vehicles mid-shift without restarting `duty_since`. |

Going off duty any way gives the vehicle back: the app, `sa_set_duty()`, or the on-duty switch in the riders list.

## Phase 2: where riders are

**How the app reports**
- The rider shares their location while **on duty with the app open**. It is not sent in the background while idle.
  - The server sets the pace: every 30 s with jobs in hand, every 2 min without.
  - A delivery's own tracking (`ping`) counts as well.
- On clocking on, the app explains why in words, then asks for "While using the app" permission once.
- It never switches on the phone's location for the rider. With location off, nothing is sent.

**Position history**
- Positions go into `sa.fleet.position` (Delivery → Fleet → Rider Positions).
- A new row is added only after a move of 25 m or more, so a rider waiting at a counter leaves one row.
- The rider's `last_lat` / `last_lng` / `last_fix_on` stay up to date for the map and for dispatch.
- Rows older than **Keep Position History** (Delivery Settings, default 7 days) are deleted nightly.

**Delivery → Fleet → Live Map**
- It refreshes every 15 s and shows:
  - riders on duty, and riders off duty but seen within the last hour;
  - each rider's colour: green when free, orange when carrying jobs, grey when not seen for **Position Goes Stale After** minutes (default 10);
  - shops;
  - a dashed line from each rider to their next stop.
- Clicking a rider shows their last 30 minutes as a trail.
- "Open" opens the rider's form, and a job link opens the delivery.
- A rider's form shows **Last Seen**, with an **On the map** button.
- The map uses Leaflet 1.9.4 (BSD-2, included in `static/lib/leaflet`) and OpenStreetMap tiles, which need internet.

| Call | Change |
|---|---|
| `rider_location(latitude, longitude, battery, accuracy=None)` | Also writes the rider's position history. |
| `ping` / `ping_batch` | Also write position history. For a batch, only the newest point is kept, because the points carry no times. |
| `me` | `fleet.features` now includes `location`. |

## Pins: where the shop and the customer are (Fleetbase "Places")

The rider's road path, the customer's tracking page and the Live Map all need both ends of the trip.

- **The shop's pin** is the first of these that exists:
  1. the shop's Contact;
  2. the warehouse's 369 Mart location (only if that module is installed);
  3. the warehouse's address.
- The shop form shows **Pickup Pin**, and **Locate shop** looks the contact's address up.
- **A customer's pin** is looked up from the street address when a job is offered.
  - It is never taken from the city alone, which would send riders to the town centre.
  - A cron retries every 10 minutes (Fleet: put customers and shops on the map), at one request a second as OpenStreetMap asks.
- **At delivery**, where the rider stood becomes the customer's exact pin (`doorstep`) for next time.
- **Pins typed in by the office** (`manual`) are never moved.
- **Changing the address** clears the pin.

## Nearest rider and the arrival check

- **Dispatch** (`_sa_pick_for`) keeps the old order and adds distance after load: own before courier, free before busy, then **nearest**, then sequence.
  - A missing or stale position counts as "unknown", so with no positions the pick is the same as before.
  - **Offer Only Within (km)** skips riders known to be farther. **Vehicle Required** skips riders without a rideable vehicle.
  - The offer posts "Offered to X, 1.2 km from the shop."
- **Arrived** takes the phone's position; without one, the rider's last fix under 5 minutes old is used. It is measured against the shop or the customer pin.
  - Beyond **Arrived Means Within** (default 150 m, plus the phone's accuracy up to 100 m), the job gets a note, or, with the setting on refuse, the rider is told `too_far`.
  - Missing positions never block.

## Fuel, problems, the photo at the door

| Call | What it does |
|---|---|
| `fuel_report(liters, amount, odometer, note, photo_base64, client_uuid)` | Adds a Fleet service log of type Fuel against the vehicle in hand, plus an odometer reading (it can't go backwards) and the receipt photo. |
| `vehicle_issue(category, note, photo_base64, grounded, client_uuid)` | Adds a "Reported by rider" service log. `grounded` marks the vehicle not rideable, so it's offered to nobody after this shift. |
| `upload_proof` | Also kept on the delivery (`Photo at the Door`). With **Photo Required at Delivery**, `verify_delivery` answers `proof_needed` until a photo is in. |

- Delivery → Fleet → **Fuel & Issues** lists both kinds of log.
- `me.fleet.features` now includes `geofence`, `fuel` and `proof`, and `me.fleet.proof_required` is sent.

## Tests

Run these from PowerShell with the module linked into a scratch addons folder, so nothing under Program Files changes:

```powershell
& "C:\Program Files\Odoo 19.0.20260119\python\python.exe" odoo-bin -c odoo.conf -d rider_rpc_test `
  "--addons-path=C:\Program Files\Odoo 19.0.20260119\server\odoo\addons,<scratch>\addons" `
  -u delivery_rider_rpc,delivery_fleet_ops --test-enable --test-tags=/delivery_rider_rpc,/delivery_fleet_ops `
  --stop-after-init --http-port=8211 --gevent-port=8212 --max-cron-threads=0
```

If loading fails with `SerializationFailure` on `ir_cron`, the running Odoo service is running the rider crons on the same database. Move their `nextcall` a day ahead and run again.
