{
    'name': 'Delivery Rider App (JSON-RPC)',
    'version': '19.0.1.1.0',
    'category': 'Inventory/Delivery',
    'summary': 'The rider app talks plain Odoo JSON-RPC; Odoo does the WhatsApp',
    'description': """
The rider app signs in the way every Odoo client does
(`/web/session/authenticate`) and calls one model, `sa.rider.rpc`, through
`/web/dataset/call_kw`. It never talks to WhatsApp.

Every step the rider takes runs the same `stock.picking.sa_set_state()` the
WhatsApp delivery module's own buttons run, so stock moves and the customer's
WhatsApp messages behave exactly as they do from those buttons. Neither path
registers a cash-on-delivery payment or touches an invoice; the amount to
collect is shown to the rider, nothing more. The only difference is *when* the
messages go: a call from the app queues them in `sa.rider.outbox` and answers
the rider at once; a cron sends them seconds later, in order, and retries what
failed.

* no custom tokens or REST routes - a rider is an Odoo user linked to a
  `sa.delivery.partner`;
* a `client_uuid` on every action makes offline replays safe;
* failed WhatsApp messages are listed with a Retry button;
* Expo push to the rider's phone when a job is offered or taken away;
* each job goes to the least busy rider on duty; a rider can decline an offer,
  and an offer nobody accepts in time (Delivery Settings) moves on by itself;
* only the shop confirms a returned parcel, not the rider.

Nothing in `sales_automation_*` is edited. Uninstalling this module leaves the
existing `/api/delivery` API and the WhatsApp flow exactly as they were -
including the delivery module's own "first rider on duty" assignment.
""",
    'author': 'Alphalize',
    'license': 'LGPL-3',
    'depends': ['sales_automation_delivery'],
    'data': [
        'security/groups.xml',
        'security/ir.model.access.csv',
        'data/cron.xml',
        'views/sa_rider_outbox_views.xml',
        'views/sa_delivery_partner_views.xml',
        'views/sa_delivery_settings_views.xml',
    ],
    'installable': True,
    'application': False,
}
