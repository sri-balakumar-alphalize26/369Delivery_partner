"""Where each rider has been, for the live map's trail and for dispatch.

Two sources feed it, both through `sa.rider.rpc`:

* `rider_location` - the app's heartbeat while the rider is on duty and the
  app is open, every 30 s with work in hand and every 2 min without;
* `ping` / `ping_batch` - the delivery tracking the customer's page already
  gets while a parcel is out for delivery.

Either way the rider's own `last_lat` / `last_lng` / `last_fix_on` is brought
up to date - that is what the map and dispatch read. A row is only added once
the rider has moved 25 m from their last one, the same rule the customer's
tracking uses, so a rider waiting at a counter leaves one row, not forty.
"""

from datetime import timedelta

from odoo import api, fields, models

_MIN_MOVE_M = 25.0


class SaFleetPosition(models.Model):
    _name = 'sa.fleet.position'
    _description = 'Rider Position History'
    _order = 'recorded_on desc, id desc'
    _rec_name = 'rider_id'

    rider_id = fields.Many2one(
        'sa.delivery.partner', string='Rider', required=True, index=True,
        ondelete='cascade')
    vehicle_id = fields.Many2one(
        'fleet.vehicle', string='Vehicle', ondelete='set null')
    picking_id = fields.Many2one(
        'stock.picking', string='Delivery', ondelete='set null',
        help="Set when the position came from a delivery's own tracking.")
    latitude = fields.Float('Latitude', digits=(10, 7))
    longitude = fields.Float('Longitude', digits=(10, 7))
    accuracy = fields.Float('Accuracy (m)')
    battery = fields.Float('Battery', help="0 to 1, as the phone reported it.")
    recorded_on = fields.Datetime(
        'Recorded On', required=True, index=True,
        default=fields.Datetime.now)

    @api.model
    def _sa_record(self, rider, lat, lng, accuracy=None, battery=None,
                   picking=None):
        """Bring the rider's last position up to date; add a row if they moved.

        Returns the row written, or an empty recordset for a bad fix or a move
        under 25 m.
        """
        try:
            lat, lng = float(lat), float(lng)
        except (TypeError, ValueError):
            return self.browse()
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0) or (
                not lat and not lng):
            return self.browse()

        now = fields.Datetime.now()
        vals = {'last_lat': lat, 'last_lng': lng, 'last_fix_on': now}
        try:
            vals['last_battery'] = float(battery)
        except (TypeError, ValueError):
            pass
        rider.sudo().write(vals)

        last = self.sudo().search([('rider_id', '=', rider.id)], limit=1)
        metres = self.env['sa.delivery.ping']._sa_metres
        if last and metres(last.latitude, last.longitude, lat,
                           lng) < _MIN_MOVE_M:
            return self.browse()
        try:
            accuracy = float(accuracy or 0.0)
        except (TypeError, ValueError):
            accuracy = 0.0
        return self.sudo().create({
            'rider_id': rider.id,
            'vehicle_id': rider.vehicle_id.id or False,
            'picking_id': picking.id if picking else False,
            'latitude': lat,
            'longitude': lng,
            'accuracy': accuracy,
            'battery': vals.get('last_battery', 0.0),
            'recorded_on': now,
        })

    @api.model
    def _cron_purge(self):
        """Forget positions older than Delivery Settings' keep-days."""
        days = self.env['sa.delivery.settings'].sudo().get_settings() \
            .fleet_position_keep_days
        if not days or days <= 0:
            return 0
        old = self.sudo().search(
            [('recorded_on', '<', fields.Datetime.now() - timedelta(days=days))])
        count = len(old)
        old.unlink()
        return count
