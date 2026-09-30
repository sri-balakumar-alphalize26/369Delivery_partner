"""Who gets the next job: the nearest free rider.

`delivery_rider_rpc` ranks riders on duty by kind, then load, then sequence.
This keeps that order and slips distance in after load: own riders still come
before couriers and a free rider before a busy one, but among free riders the
one closest to the shop now wins instead of the one with the lowest sequence.

A rider whose position is missing or stale counts as infinitely far, so with
nobody reporting a position the pick is exactly the old one.

Two rules on top, both from Delivery Settings:

* **Vehicle Required** - a rider without a vehicle, or with a grounded one,
  is not offered work;
* **Offer Only Within (km)** - a rider known to be farther than that is not
  offered this shop's jobs. Unknown is not "far".
"""

from datetime import timedelta

from odoo import api, fields, models

from odoo.addons.delivery_rider_rpc.models.rider_dispatch import _BUSY

from .geo import metres_between

_FAR = float('inf')


class SaDeliveryPartner(models.Model):
    _inherit = 'sa.delivery.partner'

    def _sa_fleet_fresh_fix(self):
        """True when this rider's last position is recent enough to trust."""
        self.ensure_one()
        if not self.last_fix_on or not (self.last_lat or self.last_lng):
            return False
        minutes = self.env['sa.delivery.settings'].sudo().get_settings() \
            .fleet_fix_max_age_min or 10
        return fields.Datetime.now() - self.last_fix_on <= timedelta(
            minutes=minutes)

    @api.model
    def _sa_pick_for(self, shop):
        settings = self.env['sa.delivery.settings'].sudo().get_settings()
        riders = self.sudo().search([('on_duty', '=', True)])
        exclude = self.env.context.get('rider_rpc_exclude') or []
        if exclude:
            riders = riders.filtered(lambda r: r.id not in exclude)
        if shop:
            riders = riders.filtered(
                lambda r: not r.shop_ids or shop in r.shop_ids)
        if settings.fleet_vehicle_required:
            riders = riders.filtered(
                lambda r: r.vehicle_id and not r.vehicle_id.sa_grounded)
        if not riders:
            return self.browse()

        point = shop._sa_fleet_point() if shop else None
        distance = {}
        for rider in riders:
            metres = None
            if point and rider._sa_fleet_fresh_fix():
                metres = metres_between(rider.last_lat, rider.last_lng,
                                        point['lat'], point['lng'])
            distance[rider.id] = _FAR if metres is None else metres

        max_km = settings.fleet_dispatch_max_km or 0.0
        if max_km > 0:
            riders = riders.filtered(
                lambda r: distance[r.id] == _FAR
                or distance[r.id] <= max_km * 1000)
            if not riders:
                return self.browse()

        load = dict.fromkeys(riders.ids, 0)
        for row in self.env['stock.picking'].sudo()._read_group(
                [('sa_delivery_partner_id', 'in', riders.ids),
                 ('sa_delivery_state', 'in', _BUSY)],
                ['sa_delivery_partner_id'], ['__count']):
            load[row[0].id] = row[1]

        kind_rank = {'own': 0, 'third_party': 1}
        return min(riders, key=lambda r: (kind_rank.get(r.kind, 2), load[r.id],
                                          distance[r.id], r.sequence, r.id))
