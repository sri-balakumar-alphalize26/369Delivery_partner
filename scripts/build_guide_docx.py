# -*- coding: utf-8 -*-
"""
Builds "369 Delivery Partner App - Visual Guide" as a real .docx file.

Run:  py scripts/build_guide_docx.py

Design notes
------------
* Every ASCII diagram is rendered in Consolas inside a single-cell shaded table so
  the box-drawing characters stay aligned. Proportional fonts scramble them.
* No emoji inside diagram blocks - emoji fall back to a non-monospace font and
  break the alignment. Emoji are only used in prose and headings.
* Font size per diagram is chosen from the widest line so nothing wraps.
* A validator at the end reports any diagram whose box lines are uneven.
"""

import os
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------
INK    = RGBColor(0x1A, 0x1A, 0x1A)
GREEN  = RGBColor(0x14, 0x6C, 0x33)
RED    = RGBColor(0xB3, 0x24, 0x1A)
BLUE   = RGBColor(0x16, 0x53, 0x9B)
ORANGE = RGBColor(0xB2, 0x5E, 0x00)
PURPLE = RGBColor(0x63, 0x28, 0x86)
GREY   = RGBColor(0x5A, 0x5A, 0x5A)
WHITE  = RGBColor(0xFF, 0xFF, 0xFF)

F_DIAGRAM = "F3F5F8"
F_GREEN   = "E3F3E8"
F_RED     = "FBE7E5"
F_BLUE    = "E4EDF9"
F_ORANGE  = "FCF0DC"
F_PURPLE  = "F0E8F6"
F_BAND    = "16539B"
F_THEAD   = "22436E"
F_ZEBRA   = "F2F5F9"

BODY_FONT = "Calibri"
MONO_FONT = "Consolas"

_warnings = []


# --------------------------------------------------------------------------
# low-level helpers
# --------------------------------------------------------------------------
def _shade(el, fill):
    """Apply a solid background fill to a paragraph or table-cell element."""
    pr = el.get_or_add_pPr() if el.tag.endswith("}p") else el.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    pr.append(shd)


def shade_para(paragraph, fill):
    _shade(paragraph._p, fill)


def shade_cell(cell, fill):
    _shade(cell._tc, fill)


def cell_margins(cell, top=80, start=140, bottom=80, end=140):
    """Set cell padding in twentieths of a point."""
    tcPr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for tag, val in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = OxmlElement(f"w:{tag}")
        node.set(qn("w:w"), str(val))
        node.set(qn("w:type"), "dxa")
        mar.append(node)
    tcPr.append(mar)


def table_borders(table, color="C9D3E0", size=6):
    tblPr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{edge}")
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), str(size))
        e.set(qn("w:space"), "0")
        e.set(qn("w:color"), color)
        borders.append(e)
    tblPr.append(borders)


def run(paragraph, text, *, bold=False, italic=False, color=None, size=None,
        font=BODY_FONT, highlight=None):
    r = paragraph.add_run(text)
    r.bold = bold
    r.italic = italic
    r.font.name = font
    r.font.size = Pt(size if size else 10.5)
    r.font.color.rgb = color if color else INK
    if highlight:
        r.font.highlight_color = highlight
    # make the font stick for non-ASCII glyphs too
    rPr = r._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rFonts.set(qn(attr), font)
    return r


# --------------------------------------------------------------------------
# block builders
# --------------------------------------------------------------------------
def band(doc, text, fill=F_BAND):
    """Full-width coloured section heading."""
    doc.add_paragraph()
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.keep_with_next = True
    shade_para(p, fill)
    run(p, "  " + text, bold=True, color=WHITE, size=14)
    return p


def sub(doc, text, color=BLUE):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    run(p, text, bold=True, color=color, size=12)
    return p


def para(doc, pieces, space_after=6, indent=0):
    """pieces: str, or list of (text, kwargs) tuples."""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.12
    if indent:
        p.paragraph_format.left_indent = Inches(indent)
    if isinstance(pieces, str):
        run(p, pieces)
    else:
        for item in pieces:
            if isinstance(item, str):
                run(p, item)
            else:
                text, kw = item
                run(p, text, **kw)
    return p


def bullet(doc, pieces, color=INK):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.28)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.1
    run(p, "•  ", bold=True, color=color)
    if isinstance(pieces, str):
        run(p, pieces)
    else:
        for item in pieces:
            if isinstance(item, str):
                run(p, item)
            else:
                text, kw = item
                run(p, text, **kw)
    return p


def diagram(doc, name, text, fill=F_DIAGRAM, color=INK):
    """Monospace ASCII block inside a shaded single-cell table."""
    lines = text.strip("\n").split("\n")
    widest = max(len(ln) for ln in lines)
    size = 9.0 if widest <= 62 else (8.5 if widest <= 78 else 7.8)

    _validate(name, lines)

    t = doc.add_table(rows=1, cols=1)
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    t.autofit = False
    cell = t.cell(0, 0)
    cell.width = Inches(6.95)
    shade_cell(cell, fill)
    cell_margins(cell, top=120, bottom=120, start=160, end=160)
    table_borders(t, color="D5DCE5")

    first = True
    for ln in lines:
        p = cell.paragraphs[0] if first else cell.add_paragraph()
        first = False
        pf = p.paragraph_format
        pf.space_before = Pt(0)
        pf.space_after = Pt(0)
        pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY
        pf.line_spacing = Pt(size + 2.2)
        pf.keep_together = True
        run(p, ln if ln else " ", font=MONO_FONT, size=size, color=color)

    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return t


def callout(doc, title, body, fill=F_ORANGE, color=ORANGE):
    t = doc.add_table(rows=1, cols=1)
    t.autofit = False
    cell = t.cell(0, 0)
    cell.width = Inches(6.95)
    shade_cell(cell, fill)
    cell_margins(cell, top=120, bottom=120, start=160, end=160)
    table_borders(t, color="DDDDDD")

    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(3)
    run(p, title, bold=True, color=color, size=11)

    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    p2.paragraph_format.line_spacing = 1.12
    if isinstance(body, str):
        run(p2, body)
    else:
        for item in body:
            if isinstance(item, str):
                run(p2, item)
            else:
                text, kw = item
                run(p2, text, **kw)

    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return t


def make_table(doc, headers, rows, widths=None, head_fill=F_THEAD, zebra=True,
               body_size=9.5, cell_colors=None):
    """cell_colors: optional dict {(row_idx, col_idx): RGBColor}."""
    t = doc.add_table(rows=1, cols=len(headers))
    t.autofit = False
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    table_borders(t)

    if widths is None:
        widths = [6.95 / len(headers)] * len(headers)

    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].width = Inches(widths[i])
        shade_cell(hdr[i], head_fill)
        cell_margins(hdr[i])
        p = hdr[i].paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        run(p, h, bold=True, color=WHITE, size=9.5)

    for r_idx, row in enumerate(rows):
        cells = t.add_row().cells
        for c_idx, val in enumerate(row):
            cells[c_idx].width = Inches(widths[c_idx])
            cell_margins(cells[c_idx])
            if zebra and r_idx % 2 == 1:
                shade_cell(cells[c_idx], F_ZEBRA)
            p = cells[c_idx].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.05
            col = (cell_colors or {}).get((r_idx, c_idx), INK)
            run(p, str(val), size=body_size, color=col,
                bold=(c_idx == 0 and len(headers) > 2))

    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return t


def _validate(name, lines):
    """Warn if the box-drawing lines in a block are not the same width."""
    box = [ln for ln in lines if ln.startswith(("┌", "├", "└", "│", "+-", "|"))]
    if len(box) > 1:
        lens = {len(ln) for ln in box}
        if len(lens) > 1:
            _warnings.append(f"{name}: uneven box widths {sorted(lens)}")


def page_break(doc):
    doc.add_page_break()


def add_page_numbers(section):
    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run(p, "369 Delivery Partner  ·  Visual Guide  ·  page ", size=8, color=GREY)
    r = p.add_run()
    r.font.size = Pt(8)
    r.font.color.rgb = GREY
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    r._element.addnext(fld)


# ==========================================================================
# DIAGRAMS  (ASCII only - no emoji, or alignment breaks)
# ==========================================================================
D_THREE_APPS = """
+------------------+--------------------+---------------------+
|   CUSTOMER APP   |    PARTNER APP     |   ADMIN / STORE     |
|                  |   << WE BUILD >>   |                     |
+------------------+--------------------+---------------------+
| browse & order   | accept orders      | pack the orders     |
| pay              | ride to the store  | assign riders       |
| track the rider  | pick up            | monitor everything  |
| rate             | deliver            | handle problems     |
|                  | earn money         |                     |
+------------------+--------------------+---------------------+
"""

D_SYSTEM = """
   CUSTOMER APP            STORE PANEL              PARTNER APP
   ------------            -----------              -----------
   places order  --------> order appears
                           staff packs it
                           marks "ready"  --------> (!) ORDER ALERT
                                                    accept
                           hands over bag <-------- rider arrives
                                                    picked up
   sees the rider <----------- live GPS <---------- riding
   moving on a map
   gives the OTP ---------------------------------> enters OTP
                                                    DELIVERED
                                                    +Rs 42 earned
"""

D_JOURNEY = """
  STAGE 1         STAGE 2         STAGE 3        STAGE 4        STAGE 5
  ONBOARD    ->   GO ONLINE  ->   GET ORDER  ->  DELIVER   ->   GET PAID
  --------        ---------       ---------      -------        --------
  phone + OTP     duty toggle     push alert     to the store   earnings
  profile         GPS starts      30 sec timer   pick up        wallet
  documents       joins pool      accept         to customer    weekly
  admin approves  ready           or reject      OTP proof      bank payout

  ONCE            EVERY DAY       PER ORDER      PER ORDER      EVERY WEEK
"""

D_SIMPLE_FLOW = """
  ASSIGNED
     |  rider taps "Accept"
     v
  ACCEPTED        ->  show route to the STORE
     |  taps "Reached Store"
     v
  AT_STORE        ->  verify the item list
     |  taps "Picked Up"
     v
  PICKED_UP       ->  route switches to the CUSTOMER
     |  taps "Reached Location"
     v
  AT_CUSTOMER     ->  collect cash, ask for the OTP
     |  enters the 4-digit OTP
     v
  DELIVERED       ->  earnings credited, back to online
"""

D_STATE_MACHINE = """
                  +---------------+
                  |   SEARCHING   |  engine is looking for a rider
                  +-------+-------+
                          | offered
                  +-------v-------+
          +-------+    OFFERED    +-------+
  reject  |       +-------+-------+       |  nobody accepts
  timeout |               | accept        v
          |       +-------v-------+   UNASSIGNED
          +------>|   ACCEPTED    |       |
                  +-------+-------+       +--> back to SEARCHING
                          | reached the store
                  +-------v-------+
                  |   AT_STORE    |  may WAIT here if not packed
                  +-------+-------+  (waiting pay starts after 5 min)
                          | picked up
                  +-------v-------+
                  |   PICKED_UP   |
                  +-------+-------+
                          | reached the location
                  +-------v-------+
                  |  AT_CUSTOMER  |
                  +---+-------+---+
             OTP ok   |       |  customer unreachable
                  +---v---+   v
                  |DELIVER|  UNDELIVERED
                  |  ED   |   |  3 calls + 10 min wait
                  +-------+   v
                          RETURN_TO_STORE
                              |
                              v
                          RETURNED
"""

D_HOME = """
+------------------------------------+
|  Rajesh K.            ONLINE  [ON] |
|  Store: Sector 12 Dark Store       |
+------------------------------------+
|                                    |
|            Rs 840                  |
|            Today's earnings        |
|                                    |
|   12 orders   4h 20m   rating 4.8  |
+------------------------------------+
|  Cash to deposit         Rs 1,250  |
+------------------------------------+
|  12 / 15 orders  ->  +Rs 150 bonus |
|  ################-----   3 to go!  |
+------------------------------------+
|  Waiting for orders...             |
|  You are #3 in the store queue     |
+------------------------------------+
"""

D_ALERT = """
+------------------------------------+
|           (!)  NEW ORDER           |
|                                    |
|              Rs 42                 |
|                                    |
|   PICKUP:  Sector 12 Store         |
|   DROP:    B-404, Green Valley     |
|            2.1 km    approx 9 min  |
|                                    |
|   CASH TO COLLECT:   Rs 350        |
|                                    |
|   +----------------------------+   |
|   |       ACCEPT        (24)   |   |
|   +----------------------------+   |
|              Reject                |
+------------------------------------+
"""

D_ACTIVE = """
+------------------------------------+
|  Order #4821                Rs 42  |
+------------------------------------+
|  [x]  Accepted                     |
|  [x]  Reached the store            |
|  [x]  Picked up                    |
|  [>]  On the way    <- you are     |
|  [ ]  Delivered          here      |
+------------------------------------+
|  DROP:  B-404, Green Valley        |
|         "Ring the bell twice"      |
|                                    |
|    [  NAVIGATE  ]    [  CALL  ]    |
+------------------------------------+
|  +------------------------------+  |
|  |      REACHED LOCATION        |  |
|  +------------------------------+  |
+------------------------------------+
"""

D_PROOF = """
+------------------------------------+
|  Collect Rs 350 in cash            |
|  [x] I have collected the cash     |
+------------------------------------+
|  Ask the customer for the OTP      |
|                                    |
|      +---+ +---+ +---+ +---+       |
|      | 4 | | 7 | | 2 | |   |       |
|      +---+ +---+ +---+ +---+       |
|                                    |
|  Customer not available?           |
+------------------------------------+
"""

D_FILTER = """
WHERE  online               = true
  AND  verified             = approved
  AND  current_orders       < max_capacity
  AND  distance_to_pickup   < search_radius
  AND  vehicle_type fits the order      (a fridge will not go on a cycle)
  AND  cash_in_hand         < cod_limit (wallet full = no COD orders)
  AND  not on a break
"""

D_SCORE = """
score =   (distance_to_pickup   x 50)    <- dominant factor
        - (idle_time_minutes    x  5)    <- fairness: longest wait wins
        - (rating               x 10)
        + (current_load         x 30)
        - (acceptance_rate      x 10)

                 LOWEST score wins the order
"""

D_ROUNDS = """
  ROUND 1    top 3 riders     radius 3 km    30 seconds
     |   all rejected or timed out
     v
  ROUND 2    next 3 riders    radius 5 km    payout +Rs 10
     |   still nothing
     v
  ROUND 3    next 3 riders    radius 8 km    payout +Rs 25
     |   still nothing
     v
  ESCALATE TO THE OPS DASHBOARD   ->   a human takes over
"""

D_PAYOUT = """
  PER ORDER
     base fare                             Rs 20
     + distance    (Rs 6/km beyond 2 km)   Rs  6
     + waiting     (Rs 1/min after 5 min)  Rs  4
     + surge       (rain / peak  x1.5)     Rs 15
     + tip                                 Rs 10
     --------------------------------------------
     ORDER TOTAL                           Rs 55

  PER DAY
     + incentive     "15 orders  ->  +Rs 150"
     + login bonus for peak slots

  PER WEEK
     - penalties     (late / cancelled / no-show)
     --------------------------------------------
     = MONDAY BANK TRANSFER
"""

D_COD = """
  Rider collects cash   ->   wallet goes NEGATIVE  (they owe you)
  Rider earns fees      ->   wallet goes POSITIVE

     Cash collected today            - 2,400
     Earned today                    +   840
     ---------------------------------------
     OWES THE COMPANY                Rs 1,560

  Limit Rs 3,000  ->  at the limit the app BLOCKS going online
                      until the rider deposits at the store
"""

D_TRACKING = """
  1.  Foreground service + a permanent notification
         "369Delivery is tracking your location"
         legally required, and it keeps the process alive

  2.  Ask for "Allow all the time" location
         NOT "only while using the app"

  3.  Send the rider to the OEM autostart screen
         Xiaomi    Security  -> Autostart -> enable
         Oppo      Battery   -> allow background
         Vivo      iManager  -> background high power
         ...and re-check on every launch, because OEM
         updates silently reset these

  4.  Battery-optimisation exemption prompt

  5.  SERVER-SIDE WATCHDOG
         no ping for 3 min from an "online" rider
         ->  mark them stale, stop assigning orders,
             push "please reopen the app"
"""

D_PING = """
  Idle at the store     ->   every 60 sec,  low accuracy
  On an active order    ->   every 10 sec,  high accuracy
  Offline               ->   no tracking at all, ever

  Batch 5 pings together and send once every 30 seconds.
  One request per GPS reading = dead battery + burnt data pack.
"""

D_DATA = """
  RIDER                     ORDER                     LOCATION_PING
  -----                     -----                     -------------
  id                        id                        rider_id
  phone                     status  <- state m/c      lat, lng
  name                      rider_id                  accuracy
  vehicle_type              store_id                  recorded_at
  status pending/approved   pickup_lat/lng/address
  is_online                 drop_lat/lng/address      ORDER_EVENT
  last_lat / last_lng       drop_otp                  -----------
  last_ping_at <-watchdog   payout_breakdown {}       order_id
  cash_in_hand              cod_amount                from_status
  rating                    items []                  to_status
  push_token                accepted_at               at, lat, lng
                            picked_up_at
  EARNING                   delivered_at              SHIFT
  -------                                             -----
  rider_id                                            rider_id
  order_id                                            store_id
  type base/distance/                                 starts_at
       surge/tip/penalty                              ends_at
  amount                                              checked_in_at
  payout_id
"""

D_CONFIG = """
  ONE APP, driven by config the backend sends down:

     assignment_mode   auto | offer | manifest
     can_reject        true | false
     orders_per_trip   1 | 3 | 40
     rider_home_base   store | zone | hub
     shift_required    true | false
     search_radius     3 km | 6 km | 10 km
     proof_type        otp | signature | photo

  Start with the dark-store values. Adding food delivery
  later becomes a CONFIG ROW, not a rewrite.
"""


# ==========================================================================
# document
# ==========================================================================
def build(path):
    doc = Document()

    st = doc.styles["Normal"]
    st.font.name = BODY_FONT
    st.font.size = Pt(10.5)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)

    sec = doc.sections[0]
    sec.page_width = Inches(8.27)
    sec.page_height = Inches(11.69)
    sec.top_margin = Inches(0.62)
    sec.bottom_margin = Inches(0.62)
    sec.left_margin = Inches(0.62)
    sec.right_margin = Inches(0.62)
    add_page_numbers(sec)

    # ---------------- title ----------------
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(0)
    run(p, "369 DELIVERY", bold=True, color=BLUE, size=30)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    run(p, "Partner App — Visual Guide", bold=True, color=INK, size=22)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(14)
    run(p, "How a delivery rider app actually works, end to end.", color=GREY, size=12, italic=True)

    callout(
        doc,
        "Read this first",
        [
            "A delivery partner app is a ", ("work tool", {"bold": True}),
            ", not a shopping app. The rider stares at it for 8 hours a day, "
            "one-handed, on a cheap phone, in bright sunlight, often wearing gloves. "
            "That single fact drives every decision in this document: ",
            ("huge buttons, very few screens, loud alerts, and never more than one "
             "thing to do next.", {"bold": True, "highlight": WD_COLOR_INDEX.YELLOW}),
        ],
        fill=F_BLUE, color=BLUE,
    )

    sub(doc, "Colour key used throughout this document")
    legend = make_table(
        doc,
        ["Colour", "Meaning"],
        [
            ["GREEN", "The happy path - things going right, and money earned"],
            ["RED", "Failure paths, warnings, and the things that break in production"],
            ["BLUE", "The rider, and actions the rider takes"],
            ["ORANGE", "Decisions YOU need to make"],
            ["YELLOW HIGHLIGHT", "Critical rules - do not skip these"],
            ["GREY BOX", "A diagram or a screen mockup"],
        ],
        widths=[1.7, 5.25],
        cell_colors={
            (0, 0): GREEN, (1, 0): RED, (2, 0): BLUE,
            (3, 0): ORANGE, (4, 0): PURPLE, (5, 0): GREY,
        },
    )
    # the legend should demonstrate the highlight, not just name it
    legend.rows[5].cells[0].paragraphs[0].runs[0].font.highlight_color =         WD_COLOR_INDEX.YELLOW

    sub(doc, "What is inside")
    for i, t in enumerate([
        "The three apps - and which one we are building",
        "The rider's journey - five stages",
        "The four delivery models - and how to support all of them",
        "The screens the rider actually sees",
        "The assignment engine - who gets the order?",
        "The complete state machine - including the ugly paths",
        "The money - payouts, incentives and cash",
        "Location tracking - where these apps die",
        "The data model - six tables run everything",
        "Why the partner app is the hard one",
        "Decisions still open",
    ], start=1):
        bullet(doc, [(f"{i}.  ", {"bold": True, "color": BLUE}), t])


    # ---------------- 1 ----------------
    band(doc, "1.  The three apps")
    para(doc, "Every Blinkit-style business runs three separate applications. People "
              "often assume it is one app. It is not.")
    diagram(doc, "three_apps", D_THREE_APPS)
    callout(doc, "Where we are",
            [("369Delivery_partner", {"bold": True}),
             " is the middle column - the rider's app. The customer app and the admin "
             "panel come later. ",
             ("If you use Odoo as the backend, the admin panel is generated for you "
              "for free.", {"highlight": WD_COLOR_INDEX.YELLOW})],
            fill=F_GREEN, color=GREEN)

    sub(doc, "How the three talk to each other")
    diagram(doc, "system", D_SYSTEM)


    # ---------------- 2 ----------------
    band(doc, "2.  The rider's journey - five stages")
    diagram(doc, "journey", D_JOURNEY)

    sub(doc, "Stage 1  —  Becoming a partner   (happens once)", color=GREY)
    para(doc, "Download, enter phone, verify OTP, fill in profile and vehicle, upload "
              "documents (Aadhaar, PAN, driving licence, RC, bank details). The account "
              "then sits at PENDING until an admin approves it.")
    callout(doc, "Rule",
            [("Only an APPROVED rider can go online.", {"bold": True}),
             " Everyone else sees a waiting screen. This is not optional - you are "
             "handing strangers other people's goods and cash."],
            fill=F_RED, color=RED)

    sub(doc, "Stage 2  —  Starting the shift   (every day)", color=GREY)
    para(doc, "One big toggle: OFFLINE / ONLINE. Going online starts GPS tracking and "
              "puts the rider into the pool of available riders. Going offline stops "
              "tracking completely.")

    sub(doc, "Stage 3  —  Getting an order   (per order)", color=GREY)
    para(doc, "The customer orders, the store packs it, and the system looks for the "
              "nearest online rider. The rider gets a push notification, a full-screen "
              "alert and a sound - even if the phone is locked.")

    sub(doc, "Stage 4  —  Fulfilling the order   (per order)", color=GREY)
    para(doc, "This is the heart of the app. The order moves through fixed statuses, "
              "and the rider's screen changes at every step:")
    diagram(doc, "simple_flow", D_SIMPLE_FLOW, fill=F_GREEN, color=GREEN)
    callout(doc, "The OTP is the proof of delivery",
            "The customer's app shows a 4-digit code. The rider asks for it and types "
            "it in. No code, no delivery. (The alternative is a photo for "
            "'leave at the door' orders.)",
            fill=F_BLUE, color=BLUE)

    sub(doc, "Stage 5  —  Getting paid   (every week)", color=GREY)
    para(doc, "Each delivered order adds to the day's earnings. Money reaches the bank "
              "account weekly. Section 7 covers this properly - it is more complicated "
              "than it looks.")


    # ---------------- 3 ----------------
    band(doc, "3.  The four delivery models")
    para(doc, "There are four kinds of delivery business. They look different, but "
              "underneath they are the same app.")
    make_table(
        doc,
        ["Model", "Examples", "Shape of the work"],
        [
            ["1. Dark store", "Blinkit, Zepto", "store -> home,  2 km,  10 minutes"],
            ["2. Food / market", "Swiggy, Zomato", "restaurant -> home,  5 km,  30 minutes"],
            ["3. Courier (P2P)", "Porter, Dunzo", "anywhere -> anywhere, customer defines both"],
            ["4. E-com last mile", "Delhivery, Ecom", "hub -> 30 homes in one trip, all day"],
        ],
        widths=[1.6, 1.6, 3.75],
    )

    callout(doc, "The insight that saves you a rewrite",
            [("Strip away the branding and every one of them is the same thing: a JOB "
              "with a PICKUP point, a DROP point, and a rider walking through a fixed "
              "list of statuses.", {"bold": True}),
             "  The differences are not different apps - they are settings."],
            fill=F_ORANGE, color=ORANGE)

    make_table(
        doc,
        ["Setting", "Dark store", "Food", "Courier", "Last mile"],
        [
            ["assignment_mode", "auto", "offer", "offer", "manifest"],
            ["can_reject", "NO", "yes", "yes", "NO"],
            ["orders_per_trip", "1 - 2", "1 - 3", "1", "20 - 40"],
            ["rider_home_base", "one store", "a zone", "a zone", "a hub"],
            ["shift_required", "yes, slots", "no", "no", "yes"],
            ["search_radius", "3 km", "6 km", "10 km", "n/a"],
            ["proof_type", "OTP", "OTP", "signature", "OTP + photo"],
        ],
        widths=[1.75, 1.35, 1.0, 1.25, 1.6],
        body_size=9,
    )

    diagram(doc, "config", D_CONFIG, fill=F_ORANGE, color=ORANGE)

    para(doc, [("Only model 4 genuinely breaks the mould", {"bold": True}),
               " - 30 stops in one trip needs a route-list screen instead of a "
               "single-order screen. Treat that as a separate mode you add much "
               "later, if ever."])

    sub(doc, "The two models you will actually choose between")
    make_table(
        doc,
        ["", "Dark-store model  (Blinkit)", "Marketplace model  (Swiggy)"],
        [
            ["Rider belongs to", "ONE store, sits there physically", "A zone, roams around"],
            ["Shifts", "Books slots in advance (6-10 pm)", "Logs in whenever they like"],
            ["Getting orders", "Auto-assigned, often cannot reject", "Offer -> accept or reject"],
            ["Trip length", "8-12 minutes,  2 km", "20-40 minutes,  5 km"],
            ["Rider waits", "Inside the store, in a queue", "Anywhere in the zone"],
        ],
        widths=[1.5, 2.75, 2.7],
    )
    para(doc, [("Blinkit is the first one. ", {"bold": True}),
               "Riders sit at the dark store on a bench. An order pops, they grab the "
               "packed bag, ride 2 km, come back, repeat. That is exactly why Blinkit "
               "riders mostly ",
               ("cannot", {"italic": True}),
               " reject - they are already there, and already being paid to be there. ",
               ("This one choice changes half your app.",
                {"bold": True, "highlight": WD_COLOR_INDEX.YELLOW})])


    # ---------------- 4 ----------------
    band(doc, "4.  The screens the rider actually sees")
    para(doc, "The whole app is about eight screens. Here are the four that matter.")

    sub(doc, "Home  —  90% of the rider's time is spent here")
    diagram(doc, "home", D_HOME)
    para(doc, "Two things people forget to put on this screen, and riders check both "
              "constantly:")
    bullet(doc, [("The cash they owe", {"bold": True, "color": RED}),
                 " from COD orders."], color=RED)
    bullet(doc, [("Their position in the store queue", {"bold": True, "color": RED}),
                 " - who gets the next order."], color=RED)

    sub(doc, "The order alert  —  must wake a locked phone")
    diagram(doc, "alert", D_ALERT, fill=F_ORANGE, color=ORANGE)
    callout(doc, "The most engineering-critical screen in the app",
            [("If a rider misses this alert, they lose money.", {"bold": True}),
             " It needs full screen, a loud sound, vibration, and it must appear over "
             "the lock screen. Push notification arrives first; polling is the backup "
             "so an offer is never silently missed."],
            fill=F_RED, color=RED)

    sub(doc, "Active order  —  one big button that changes")
    diagram(doc, "active", D_ACTIVE, fill=F_GREEN, color=GREEN)
    para(doc, [("The rider never has to think. ", {"bold": True}),
               "There is always exactly ",
               ("one", {"bold": True, "italic": True}),
               " obvious next action, and the button's label comes from the current "
               "status. NAVIGATE just opens Google Maps - you do not need a map inside "
               "your app for version 1."])

    sub(doc, "Proof of delivery")
    diagram(doc, "proof", D_PROOF, fill=F_BLUE, color=BLUE)

    sub(doc, "The full screen list")
    for i, s in enumerate([
        "Splash / login  (phone + OTP)",
        "Onboarding wizard  (profile + document upload)",
        "\"Under review\" waiting screen",
        "HOME  - online/offline toggle, earnings, incentive bar",
        "Incoming order alert  (with countdown)",
        "Active order  - status stepper + navigate + call",
        "Proof of delivery  - OTP and cash",
        "Order history",
        "Earnings and wallet",
        "Profile / settings / support",
    ], start=1):
        bullet(doc, [(f"{i:>2}.  ", {"bold": True, "color": BLUE}), s])


    # ---------------- 5 ----------------
    band(doc, "5.  The assignment engine  —  who gets the order?")
    para(doc, "This is invisible in every screenshot, and it is where delivery "
              "companies actually compete. An order is ready. Which rider gets it?")

    sub(doc, "Step 1  —  Filter to eligible riders")
    diagram(doc, "filter", D_FILTER)

    sub(doc, "Step 2  —  Score the survivors")
    diagram(doc, "score", D_SCORE)
    callout(doc, "Fairness is a retention feature",
            [("That idle_time term matters far more than it looks. ", {"bold": True}),
             "Without it the same three fast riders get every order, everybody else "
             "earns nothing, and they quit."],
            fill=F_ORANGE, color=ORANGE)

    sub(doc, "Step 3  —  Dispatch.  Four strategies, and they are not equal")
    make_table(
        doc,
        ["Strategy", "How it works", "Verdict"],
        [
            ["Broadcast", "Ping everyone, first tap wins",
             "BAD - chaos, angry riders, race conditions"],
            ["Sequential", "Best rider gets 30 s, then the next",
             "OK - fair, but slow: 3 rejections = 90 s lost"],
            ["Rounds", "Top 3 at once, first accept wins",
             "BEST - what most companies use"],
            ["Auto-assign", "Just assign it, no choice given",
             "Dark store only - the rider is already there"],
        ],
        widths=[1.35, 2.55, 3.05],
        cell_colors={(0, 2): RED, (1, 2): ORANGE, (2, 2): GREEN, (3, 2): GREEN},
    )

    sub(doc, "Step 4  —  When nobody takes it")
    diagram(doc, "rounds", D_ROUNDS, fill=F_RED, color=RED)
    callout(doc, "Never let an order die silently in a queue",
            "There must always be a human at the end of the funnel.",
            fill=F_RED, color=RED)


    # ---------------- 6 ----------------
    band(doc, "6.  The complete state machine")
    para(doc, "Everyone draws the happy path. The failures are what break real apps.")
    diagram(doc, "state_machine", D_STATE_MACHINE)

    sub(doc, "The four paths people forget to build", color=RED)
    make_table(
        doc,
        ["What happens", "What the app must do"],
        [
            ["Customer cancels mid-ride",
             "Tell the rider IMMEDIATELY, and still pay them for the distance covered. "
             "If they had already picked up, send them back to the store."],
            ["Store is not ready",
             "The rider sits and waits. After 5 minutes, waiting compensation starts "
             "ticking. Riders notice instantly if you do not build this."],
            ["Customer does not answer",
             "3 call attempts, 10 minute wait, upload a photo, mark undelivered - then "
             "ride BACK. The return leg must also be paid."],
            ["Rider breaks down / accident",
             "An escape hatch that reassigns the order without penalising them. It will "
             "get abused. You still need it."],
        ],
        widths=[2.0, 4.95],
    )

    callout(doc, "Design rule",
            [("The server owns the state machine. ", {"bold": True}),
             "The app never advances a status on its own - it asks the server, and "
             "renders whatever comes back. This is what stops two riders from ever "
             "delivering the same order."],
            fill=F_BLUE, color=BLUE)


    # ---------------- 7 ----------------
    band(doc, "7.  The money")
    diagram(doc, "payout", D_PAYOUT, fill=F_GREEN, color=GREEN)

    callout(doc, "The incentive bar is not decoration",
            [("It is the most-looked-at pixel in the entire app. ", {"bold": True}),
             "A rider will work an extra hour for that Rs 150 bonus. \"3 more orders\" "
             "drives their whole evening. ",
             ("Show progress towards the target on every screen.",
              {"highlight": WD_COLOR_INDEX.YELLOW})],
            fill=F_GREEN, color=GREEN)

    sub(doc, "Cash on delivery  —  the counter-intuitive part", color=RED)
    para(doc, "Cash the rider collects is not income. It belongs to the company, and it "
              "builds up as a debt.")
    diagram(doc, "cod", D_COD, fill=F_RED, color=RED)
    callout(doc, "This surprises everyone building their first delivery app",
            "COD money makes the rider's wallet go negative, not positive. Cross the "
            "limit and they are blocked from working until they hand the cash in.",
            fill=F_RED, color=RED)


    # ---------------- 8 ----------------
    band(doc, "8.  Location tracking  —  where these apps die")
    callout(doc, "The number one technical failure in every delivery app",
            [("Android will kill your background service. ", {"bold": True}),
             "Stock Android is manageable. But Xiaomi, Oppo, Vivo, realme and OnePlus - "
             "which is most of your riders' phones in India - ship custom battery "
             "killers that murder background tasks within minutes, no matter what "
             "Google's documentation says."],
            fill=F_RED, color=RED)

    sub(doc, "The survival kit")
    diagram(doc, "tracking", D_TRACKING, fill=F_RED, color=RED)
    para(doc, [("Point 5 is the safety net. ", {"bold": True}),
               "Assume tracking WILL break, and detect it - rather than pretending it "
               "will not."])

    sub(doc, "Battery discipline  —  the phone must last 8 hours")
    diagram(doc, "ping", D_PING)

    callout(doc, "A nice touch: geofencing",
            "When the rider enters a 100 m circle around the store, auto-advance the "
            "status to AT_STORE instead of making them tap. Fewer taps while riding is "
            "both safer and faster.",
            fill=F_GREEN, color=GREEN)


    # ---------------- 9 ----------------
    band(doc, "9.  The data model")
    para(doc, "Six tables run the entire system.")
    diagram(doc, "data", D_DATA)

    callout(doc, "ORDER_EVENT looks optional.  It is not.",
            [("Every dispute is settled by that table", {"bold": True}),
             " - \"the rider never came\", \"I waited 20 minutes\", \"he marked it "
             "delivered from 2 km away\". It is the timestamped, GPS-stamped history of "
             "what really happened. ",
             ("Build it from day one - you cannot reconstruct it later.",
              {"highlight": WD_COLOR_INDEX.YELLOW})],
            fill=F_ORANGE, color=ORANGE)

    # ---------------- 10 ----------------
    band(doc, "10.  Why the partner app is the hard one")
    make_table(
        doc,
        ["The problem", "Why it hurts"],
        [
            ["Background GPS",
             "Android kills it. The rider goes invisible, the customer sees a frozen "
             "dot, and support gets a phone call. This is THE hardest part."],
            ["Battery",
             "The phone must survive an 8-hour shift with GPS on. Aggressive tracking = "
             "dead phone = angry rider who stops using your app."],
            ["No network",
             "Basements, lifts, stairwells. Every action must work offline and sync "
             "later, without ever double-applying."],
            ["Two riders, one order",
             "Both tap Accept in the same instant. This needs a real database lock, "
             "not an if-statement."],
            ["They cannot stop and read",
             "The rider is on a bike. Text must be glanceable and taps must be big, "
             "few, and forgiving."],
        ],
        widths=[1.85, 5.1],
    )

    callout(doc, "The good news",
            [("The app itself is genuinely simple - about eight screens. ",
              {"bold": True}),
             "Almost all the complexity lives in the backend (assignment, money, state) "
             "and in fighting Android's battery manager."],
            fill=F_GREEN, color=GREEN)

    # ---------------- 11 ----------------
    band(doc, "11.  Decisions still open")
    para(doc, "These shape everything downstream. Nothing gets built until they are "
              "settled.")
    make_table(
        doc,
        ["Decision", "Options", "Status"],
        [
            ["Business model", "Dark store / food / courier / all of them",
             "OPEN - biggest one"],
            ["Mobile stack", "React Native (Expo)", "DECIDED"],
            ["Backend", "Odoo 19", "DECIDED"],
            ["Odoo hosting", "Self-hosted, Odoo.sh, or Odoo Online",
             "NOT SET UP YET"],
            ["Build scope", "React Native app only; Odoo module by your team",
             "DECIDED"],
            ["Maps in v1", "No embedded map - deep-link to Google Maps",
             "DECIDED"],
            ["v1 features", "Login, duty, accept, pick up, deliver, earnings",
             "DECIDED"],
        ],
        widths=[1.6, 3.55, 1.8],
        cell_colors={
            (0, 2): RED, (1, 2): GREEN, (2, 2): GREEN, (3, 2): ORANGE,
            (4, 2): GREEN, (5, 2): GREEN, (6, 2): GREEN,
        },
    )

    callout(doc, "One warning about Odoo hosting",
            [("Odoo Online (the odoo.com SaaS) does NOT allow custom Python modules.",
              {"bold": True, "highlight": WD_COLOR_INDEX.YELLOW}),
             "  The rider API needs one. So it has to be self-hosted (Docker on a VPS, "
             "free) or Odoo.sh (paid, managed). Decide this before any backend work "
             "starts."],
            fill=F_RED, color=RED)

    doc.save(path)
    return path


if __name__ == "__main__":
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, "369_Delivery_Partner_Guide.docx")
    build(out)

    size = os.path.getsize(out)
    print(f"OK  written: {out}")
    print(f"    size:    {size:,} bytes")

    if _warnings:
        print("\nALIGNMENT WARNINGS:")
        for w in _warnings:
            print("  -", w)
        sys.exit(1)
    print("    diagrams: all box widths consistent")
