{
    'name': 'Delivery Rider App (JSON-RPC)',
    'version': '19.0.1.0.0',
    'category': 'Inventory/Delivery',
    'summary': 'The rider app talks plain Odoo JSON-RPC; Odoo does the WhatsApp',
    'description': """
The rider app signs in the way every Odoo client does
(`/web/session/authenticate`) and calls one model, `sa.rider.rpc`, through
`/web/dataset/call_kw`. It never talks to WhatsApp.

Every step the rider takes runs the same `stock.picking.sa_set_state()` the
WhatsApp delivery module's own buttons run, so stock, cash on delivery,
invoices and the customer's WhatsApp messages behave exactly as they do today.
The only difference is *when* the messages go: a call from the app queues them
in `sa.rider.outbox` and answers the rider at once; a cron sends them seconds
later, in order, and retries what failed.

* no custom tokens or REST routes - a rider is an Odoo user linked to a
  `sa.delivery.partner`;
* a `client_uuid` on every action makes offline replays safe;
* failed WhatsApp messages are listed with a Retry button;
* Expo push to the rider's phone when a job is offered or taken away.

Nothing in `sales_automation_*` is edited. Uninstalling this module leaves the
existing `/api/delivery` API and the WhatsApp flow exactly as they were.
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
    ],
    'installable': True,
    'application': False,
}
