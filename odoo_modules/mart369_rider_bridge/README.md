# 369 Mart: Rider App Bridge

Connects the rider app module, `delivery_rider_rpc`, to the 369 Mart store counter, `sales_automation_store`. Neither module is edited, and nor is anything in the 369 Mart repository.

## What it changes

At the counter, **Packed – call the rider** now picks the rider at that moment:

- **Who gets it.** The least busy rider on duty for the shop, using `delivery_rider_rpc`'s rule: own riders first, then fewest open jobs, then sequence. Riders who already declined the job, or let it run out, are skipped.
- **Before this module:**
  - Packed called only the rider picked when the order was confirmed.
  - If nobody was on duty then, the job was left in To Dispatch for the office, even with riders on duty by the time it was packed.
- **A rider chosen by a person is kept.** That means one set on the job's form or with the console's rider picker. The job's **Rider Chosen by Hand** field (`rider_rpc_hand_picked`) records this. It is cleared whenever the rider is picked automatically: at confirmation, on clocking on, on a decline or timeout, or at Packed.
- **Nobody on duty.** The job waits in To Dispatch as before. The first rider to clock on gets it.

The offer reaches the phone the same way any offer does: a push to the app, the WhatsApp job message, and the app's 10-second poll. The job's chatter records "Packed – offered to X, the least busy rider on duty".

## What the rider app is told

- **Two new keys on every job,** in both `orders` and `order`:
  - `packed_at`: when Packed was pressed, UTC ending in `Z`, or `null` before that. The offer screen shows "Packed and ready since HH:MM".
  - `assigned_by`: `office` when a person chose the rider, `auto` when the least-busy rule did.
- **A rider who loses the job is told.** If Packed moves the job away from the rider it was saved on, that rider gets a "Delivery #X moved on" push with status `passed`. The job had been on their list as AT SHOP or PACKING, so without this it would just disappear. Tapping a `passed` or `cancelled` push takes the rider to the jobs list, not to the job.

## Install

1. Make the module visible on the addons path. Link the folder into Odoo's `addons`, the same way `delivery_rider_rpc` is linked, from an elevated PowerShell:

   ```powershell
   New-Item -ItemType SymbolicLink `
     -Path "C:\Program Files\Odoo 19.0.20260119\server\odoo\addons\mart369_rider_bridge" `
     -Target "C:\Projects\APK's\369Delivery_partner\odoo_modules\mart369_rider_bridge"
   ```

2. Install it: Apps → Update Apps List → **369 Mart: Rider App Bridge**.

## Tests

Run from PowerShell, because Git Bash mangles `--test-tags`:

```powershell
& "C:\Program Files\Odoo 19.0.20260119\python\python.exe" odoo-bin -c odoo.conf -d <db> -i mart369_rider_bridge `
  --test-enable --test-tags=/mart369_rider_bridge,/delivery_rider_rpc --stop-after-init --http-port=8211 --gevent-port=8212 --max-cron-threads=0
```
