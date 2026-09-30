{
    'name': '369 Mart: Rider App Bridge',
    'version': '19.0.1.0.0',
    'category': 'Inventory/Delivery',
    'summary': 'Packed at the counter calls the least busy rider on duty',
    'description': """
Connects the rider app (`delivery_rider_rpc`) to the 369 Mart store counter
(`sales_automation_store`).

The counter's **Packed - call the rider** only called the rider picked when
the order was confirmed. With nobody on duty then, the job was left in To
Dispatch for somebody in the office, even with riders on duty by the time it
was packed. And a rider picked hours earlier could by now be the busiest.

With this module, Packed picks again: the least busy rider on duty at that
moment gets the offer, with a push to the app and the WhatsApp job message.
A rider chosen by a person - on the job's form or the console's rider picker -
is kept.

Neither `delivery_rider_rpc` nor any 369 Mart or `sales_automation_*` module
is edited. Uninstalling this one puts Packed back as it was.
""",
    'author': 'Alphalize',
    'license': 'LGPL-3',
    'depends': ['delivery_rider_rpc', 'sales_automation_store'],
    'data': [],
    'installable': True,
    'application': False,
    'auto_install': False,
}
