{
    'name': 'Delivery Fleet Ops',
    'version': '19.0.1.2.0',
    'category': 'Inventory/Delivery',
    'summary': 'Rider vehicles from the Fleet app, and a live map of riders',
    'description': """
Fleet management for the rider app (`delivery_rider_rpc`), built on Odoo's own
Fleet app. The ideas follow Fleetbase Fleet-Ops; none of its code is used.

A vehicle is Fleet's `fleet.vehicle` - plate, model, odometer, services - and
nothing about it is copied here. This module adds:

* **Rider Vehicle** on a vehicle, so only the bikes and cars meant for
  deliveries are offered in the app;
* the rider picks one when they clock on, and gives it back when they clock
  off (from the app, or from the office's on-duty switch);
* one vehicle, one rider: a vehicle out with somebody is not offered to
  anybody else;
* taking a vehicle makes the rider Fleet's **Driver**, so Fleet's own Drivers
  History shows who rode what and when;
* **Grounded** takes a vehicle out of the picker until somebody clears it;
* **Vehicle Required** in Delivery Settings refuses to clock a rider on
  without one.

And where riders are:

* the app reports the rider's position while they are on duty with the app
  open, and a delivery's own tracking counts too;
* **Delivery > Fleet > Live Map** shows every rider on duty - green free,
  orange carrying work, grey when not seen lately - with the shops, a line to
  each rider's next stop, and the selected rider's last half hour;
* positions are kept for a week (Delivery Settings), then forgotten.

Delivery managers are made Fleet officers so the Delivery > Fleet menu opens.
The map uses Leaflet (BSD-2, shipped in static/lib) and OpenStreetMap tiles.

Neither `delivery_rider_rpc` nor any `sales_automation_*` or 369 Mart module is
edited. Uninstalling this one puts clocking on back as it was.
""",
    'author': 'Alphalize',
    'license': 'LGPL-3',
    'depends': ['delivery_rider_rpc', 'fleet', 'base_geolocalize'],
    'data': [
        'security/groups.xml',
        'security/ir.model.access.csv',
        'data/fleet_data.xml',
        'data/cron.xml',
        'views/trip_views.xml',
        'views/fleet_vehicle_views.xml',
        'views/sa_delivery_partner_views.xml',
        'views/sa_delivery_settings_views.xml',
        'views/sa_fleet_position_views.xml',
        'views/menus.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'delivery_fleet_ops/static/src/live_map/*',
        ],
    },
    'installable': True,
    'application': False,
    'auto_install': False,
}
