# Delivery rider manual: progress notes

**Session ID:** `e57715d7-5a30-47a6-8329-778a321495bb`
**Date:** 2026-10-12 · **Branch:** `rider-rpc` · **Repo:** `C:\Projects\APK's\369Delivery_partner`
**Status:** stopped on request after research. Nothing is built yet: no `.md` manual content, no `build_manual.py`, no `.docx`.

## What happens when this plan is approved

1. Copy this file into the repo root, next to `369_Delivery_Partner_Guide.docx`, as
   `369_Delivery_Partner_Manual_Notes.md`.
2. Commit only that file on `rider-rpc`. Subject: `Docs: delivery rider manual notes - format spec, screens, flow and what is left`. No body and no Claude attribution, as set in memory.
   The other uncommitted app changes are left alone.
3. Push `rider-rpc:main` to both remotes using the account-name URLs. Both `main` branches are at `a7ec7f5` (HEAD), so the push adds just this one commit.

---

## 1. The request

Write a complete end-user manual for the **369 Delivery Partner** app:

- **Delivery content only.** Nothing from Service, danatfix or bookings.
- **Word `.docx`**, in the house style.
- **Screenshots:** only new-UI images, taken from `screenshots/` (no new captures).
- **Pipeline:** the user's pasted manual prompt.

| Pipeline file | What it holds |
|---|---|
| `<docs>/manual/<product>-user-manual.md` | The content |
| `build_manual.py` | The python-docx generator |
| `build-manual.ps1` | Builds .md → .docx → .pdf through Word |
| `screenshots/manifest.json` | The list of screenshots used |

A verify script then checks every construct, plus page count, bookmarks and a banned-name sweep.

The prompt's `<<< >>>` slots were not filled in. Proposed values:

- **Product:** 369 Delivery Partner
- **Brand:** Alphalize
- **Banned names:** danatfix, Technician, Service bookings, and the Sparenix and dubai test database names in body text. This list still needs the user's confirmation.

## 2. Where the house-style spec lives

- `C:\Projects\Restaurantnexgenn-main\document\manual\MANUAL-FORMAT-PROMPT.md` and `C:\Projects\KRA_KPI\documents\App manual\…` **do not exist**.
- `C:\Projects\APK's\KRA_KPI\documents\manual-build-prompt.md` confirms there is no written spec on this machine.
- `KRA_KPI\documents\kra-kpi-admin-manual.docx` was built from HTML, so it has no header or footer parts and is a poor reference.
- **The measured reference** is the python-docx Alphalize manual
  `C:\Projects\APK's\Restaurant\documents\App documents\Common_blurred\Restaurant POS User Manual.docx`.

### Measured constructs

**Page and type**
- Letter size, 12240×15840 twips.
- Margins 1440 on all sides; header and footer 720.
- Segoe UI throughout.
- Body text: 11 pt, colour 1F2937, justified, 160 after, line 240 auto.

**Header and footer**
- The cover section's header and footer are **empty**. Body sections carry the real ones.
- **Header:** Header style, bottom border single sz12 4A86C8, 80 after. Content:
  `Product` (bold, underlined, 2E74B5, 10 pt) · `  |  ` (595959) · `Guide name` (404040) · tab · `Alphalize` (bold, 2E74B5).
- **Footer:**
  - Line 1: centred, top border sz12 4A86C8, 80 before. Text `Page ` PAGE ` of ` NUMPAGES, with the fields in bold 262626.
  - Line 2: centred. `Alphalize` (bold, 2E74B5) `  ·  ` `Product — User Manual` (595959). 10 pt.

**Cover**
- Brand line in spaced capitals: bold 2E74B5 14 pt, 1200 before, centred.
- `USER GUIDE` in Title style: bold caps, 1F3864, 36 pt.
- Subtitle: 2E74B5, 20 pt.
- Tagline: italic 595959, 12 pt.
- Guide table, then a TIP callout, then a section break.

**Part banner**
- Heading1 with fill and a four-side border, sz2 2E5395.
- Indent −86 left and right; 200 before, 240 after.
- Text in white 20 pt: `  PART n TITLE`.
- Followed by a strapline in italic 595959, 12 pt.

**Heading2**
- 280 before, 120 after; run 2E74B5, 15 pt.
- Used for About This Guide, Contents, … at a Glance and Things to Remember.

**Step badge**
- Heading3, 280 before, 120 after.
- Run ` Step n ` in white 10 pt with run shading 2E74B5, then two spaces, then the title in 2E74B5 15 pt.

**Two-column table**
- Centred, fixed layout.
- Borders sz4 B7CCE4, outside and inside.
- Grid 4680/4680; cell widths 3240/6120; cell margins 80/110.
- Header row repeats (`tblHeader`), fill EAF1F8, bold 1F3864 10 pt.
- First column bold 1B3A5C, second column 1F2937, both 10 pt.

**Callout (TIP / IMPORTANT)**
- One-cell table, width 9360.
- Left border single sz30 D97706; fill FFF8E7; cell margins 140/200.
- Label in bold italic 2E74B5 11 pt, then italic 2E74B5 text.

**Figure**
- One-cell table, cell width 6624.
- Dashed sz6 9CA3AF borders, fill F7F9FC, cell margins 260/180.
- Picture inline, centred and **embedded**, about 2.7 in wide.
- Caption in italic 595959 10 pt, centred.

**Bullets**
- Tab at 605; indent left 605, hanging 317; 100 after.
- `▪` in bold 2E74B5, then a tab, then the text, with a bold lead phrase.

**End matter**
- QUICK REFERENCE banner.
- Heading2 checklist table.
- Heading2 Things to Remember bullets.
- One-sentence banner: left border sz30 2E74B5, fill EAF1F8, bold italic 1F3864 11 pt.
- Closing line: 360 before, centred, italic 595959 10.5 pt:
  `— End of Guide —` ⏎ `Alphalize  |  369 Delivery Partner User Guide`.

### Tools on this machine (all checked)
- python-docx 1.2.0 (py 3.14)
- Word: `C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE`
- pdftotext: `C:\Program Files\Git\mingw64\bin\pdftotext.exe`
- PyMuPDF (`fitz`), for reading PDF bookmarks
- pypdf and PIL

## 3. What the source shows (delivery only)

### Screens a delivery rider can reach

| Screen | Route | How the rider gets there |
|---|---|---|
| Splash | root | Every launch. It lasts at least 7 s and at most 12 s. |
| Sign-in | `app/connect.tsx` | Whenever not signed in. |
| Home | `(app)/index.tsx` | Tab. First screen after sign-in. |
| Orders | `(app)/orders.tsx` | Tab, Home → See all, or the Home figures. |
| Earnings | `(app)/earnings.tsx` | Tab. Counts and cash only, no pay. |
| Profile | `(app)/profile.tsx` | Tab. |
| Job (offer, pickup, delivery, report, decline, return, handover) | `(app)/order/[id].tsx` | Home card, Orders, a ringing offer, or a notification. |
| Parcel photos | `(app)/photos/[id].tsx` | Opens by itself after a code. The rider can't leave until Send. |
| Delivered thank-you | `(app)/done/[id].tsx` | After the delivery photos. Back to Home by itself after 8 s. |
| Past job | `(app)/past/[id].tsx` | Orders → Past → a row. |
| Set up your phone | `(app)/setup.tsx` | Home card or the Profile tile. |

- **Overlays:** SOS sheet, location popup, database and country pickers, confirm/notice popup, "Opening your job…", crash screen, photo upload bar.
- **Unreachable (leave out):** `(app)/vehicle.tsx`, and every Service route.
- **Delivery-only rider:** sees a fixed **DELIVERY** pill with nothing to tap. The Service tabs are hidden and guarded.

### Roles
- There is no role choice in the app.
- Works In on the rider record in Odoo (Delivery / Service / Delivery and Service) decides what opens, through `/api/partner/me`.
- Earnings always reads "Office rider · on salary". No pay is shown anywhere.

### Set up outside the app (in Odoo)
- **Rider record Phone** is the WhatsApp number used for sign-in. It is matched on the last 9 digits.
- **Works In** must be Delivery for a delivery-only rider.
- **Test rider tick:** fixed code 111111 and no WhatsApp.
- **Company country** sets the default country code on the sign-in screen.
- **WhatsApp sending** must be working for codes to arrive.

### Set by the build or the phone, not Odoo
- Server and database (locked build).
- **Support number:** from the build or More settings. It is currently empty in `.env`, so the tile shows "No number set".
- **Emergency contacts:** saved on the phone only, up to 2.

### Sign-in
- Server link, then Database (picker), then WhatsApp number with a country chip, then **Send code**.
- The rider types the 6-digit code under **Code from WhatsApp**, then taps **Sign in** (it does not sign in by itself).
- Resend link: "Send a new code (60s)".
- Hint: "Your work is set up by the office: Delivery, Service or both. The app opens what they chose." This mentions Service, so either leave it out or quote it as it is.
- Footer: "No code? Ask the office to check the WhatsApp number on your rider record."
- A locked build shows only the number and the code. Seven taps on the logo reveal the server fields.

### Home
- Greeting and name, the **DELIVERY** pill, and an **SOS** shield.
- **Duty card:** "You are online" / "You are off duty" with a switch.
- **Figures:** Delivered today · On the road · Cash to collect, then "{w} this week · {m} this month · {n} assigned".
- **Status lines:** "Office can see you…" and the lock-screen ring line.
- **Notifications-off card:** "Notifications are off" / "New jobs will not ring. You can miss them." with **Turn on notifications**.
- **Phone setup card:** "Finish setting up your phone".
- **Location popup** (once per session, after going on duty): "Share your location while on duty".
- **Active jobs:** a lead card with **Continue delivery** / **Open the offer**.
- **Empty states:** "Nothing to deliver" / "Nothing yet".

### Offer
- In the app: rings and vibrates for 15 s and opens by itself. If the rider is already inside a job, only a banner shows.
- Phone locked: a call-style ring for 30 s, with "Open job" / "Not now".
- Live servers send no push. The app checks every 10 s while open and every 15 s in the background.
- Jobs that are already waiting when the rider goes on duty do not ring.
- **Offer screen:**
  - "New job offer", "{Shop} → {Customer}".
  - Tiles: Collect cash, Items, Due.
  - "Accept within 0:42".
  - **Accept this job**, plus Decline and Call support.
  - At zero: "Offer expired – it went to another rider."
- **Decline:**
  - "Why decline this job?" with 4 reasons.
  - Then **Decline job** and the confirm popup "Decline this job?".
  - It can't be undone, and the job is never offered again.

### Job steps (the server decides the buttons)
1. **I'm at the counter**
2. **Collect – enter pickup code** (the counter presses Dispatch and the code box opens). There is no resend for this code; **Remind the counter** is there instead.
3. **I am near the customer** (or marked near automatically within 300 m when the server setting is on)
4. **Reached – send the customer code**
5. **Delivered – enter customer code**

Along the way:
- Call, WhatsApp and Navigate go to the shop before pickup and to the customer after.
- Navigate opens Google Maps or Waze, chosen in Profile.
- Quick messages: "I'm on my way", "I'm at the gate", and so on.
- Items "IN THE BAG" are read only.
- **Cash:** "CASH ON DELIVERY / Collect before handing over", or "ALREADY PAID / Collect nothing". A cash job can also show a card-payment QR code.
- **Code box:** 6 digits, sends by itself on the last digit. A wrong code shakes and buzzes.
- **Customer code resend:** "Didn't get it? Resend code", after a 60 s timer, up to 5 per job.
- **Job-screen warning:** 'Location is not set to "Allow all the time"' with **Open settings**.

### Parcel photos
- Minimum 2, maximum 4.
  - Pickup: Whole parcel, Label and seal, Anything else, Anything wrong.
  - Delivery: Whole parcel, Label and seal, Where you left it, Anything wrong.
- **In-app camera:** silent shutter, flash Auto/On/Off. Warning: "Photograph the parcel only. Please keep people's faces out of the photo."
- **Send {n} photos (and finish)** uploads in the background. The bar reads "Photos · S00042 · 2 of 4 · 63%" or "Waiting for signal".
- File name: `order_DDMMYY_HHmmss.jpg`, in the company's time zone.
- Past jobs show the photos, grouped Pickup / Delivery / Problem report.

### Delivered
- Green tick, "Delivered", "Thank you, {First}!".
- Rows: Order · Customer · Delivered at.
- **Back to jobs**; goes back by itself after 8 s. No pay is shown.

### Report a problem and returns
- **Report a problem:**
  - 9 reasons, an optional note (500 characters) and an optional photo.
  - **Send report**, with no confirm.
  - Afterwards: "Your reports" history, then the server's next-step banners.
- **Return to shop:** reason, then a confirm popup.
- **Bike handover:**
  - Rider A sees a 6-digit HANDOVER CODE, plus **Bike fixed – carry on** and **Get a new code**.
  - Rider B taps **Collect – enter handover code**.

### Earnings
- "Today" count, with "This week", "This month" and "On road now" tiles.
- "Cash with you · {amount}" / "The shop's money, not your pay. Hand it over at the counter."
- "Today's trips".

### Profile
- Tiles: Phone setup · Emergency contacts (2 names and numbers, **Save contacts**) · Navigation (Google Maps ↔ Waze, swapped by each tap) · Call the office.
- About this app.
- **Sign out**, with the confirm "Sign out?". The server, database and number stay saved.

### Phone setup checklist (Android only)
- Notifications on
- Location "Allow all the time"
- Battery: not restricted
- Ring over the lock screen (Android 14 and later)
- Ring in Do Not Disturb
- {Maker}: keep the app running

### SOS
1. Tap the shield. The sheet says "Hold for 3 seconds".
2. Hold the button. It sends the live location to the office and the emergency contacts.
3. "SOS sent". There are WhatsApp buttons for each contact, Call {emergency number}, and Call office.

### Safety nets
- **No-signal outbox.** Collected, Near, Reached, Report and Return wait for signal. Accept, Decline and the codes never wait.
- **Crash screen:** "Something went wrong" with **Try again** / **Go to my jobs**.
- **"Opening your job…"** when an alert opens the app.

### What the app cannot do
- No turn-by-turn directions inside the app.
- No pay.
- No in-app chat.
- No ticking of items.
- No resend of the pickup code.
- The rider can't close a return.
- No record of cash taken; the code is the proof of handover.

### Possible app bugs (report to the user, don't patch)
1. **Rider B's handover code may go up as a pickup code.** See `order/[id].tsx` ≈2553.
2. **The "Code accepted" tick and sound may be skipped** for pickup and customer codes, because of an ordering problem around `order/[id].tsx` 1011→1042→797.

## 4. Screenshots: the catalogue was stopped part-way

- **New UI** means the screens from 5–6 Oct onward (redesigned Home, Inter font), with nothing that shows removed features (role choice at sign-in, partner/trip pay) and nothing from Service.
- **Sure picks:**
  - `login-country/01-06` (sign-in, country, database)
  - `field-size/01-02`
  - `service-preview/01-rider1-delivery-only.png` (Home off duty with the DELIVERY pill)
  - `service-preview/03`
- **Still to check** (delivery folders from 6 Oct):
  - orders, profile, earnings
  - phone_setup, sos, sos_live
  - confirm_popup, notice_popup, quick_replies, trip_card
  - photo_ui, camera_flash, camera_privacy
  - resend_and_thanks, report_notes, button_check, location_banner
- **Leave out:**
  - `role_login`, `earnings/03-05` and `partner_live/07`: they show removed features.
  - Images that show real customer names or addresses, because origin2 is public.

## 5. Next steps

1. Finish the screenshot catalogue and fill in `screenshots/manifest.json`.
2. Write `docs/manual/369-delivery-partner-user-manual.md`.
   - **Book One (riders):** Sign in · Your shift · Taking a job · Pickup · Delivery · Photos · When things go wrong · Profile, setup and SOS.
   - **Book Two (office):** Works In, test rider, WhatsApp, phone setup.
3. Write `build_manual.py`, `build-manual.ps1` (Python and Word in separate processes, `-RenderOnly`) and the verify script.
4. Build, verify (all green), and run the banned-name sweep. Then tell the user about the two possible bugs.
