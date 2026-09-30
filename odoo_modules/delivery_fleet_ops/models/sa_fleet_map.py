"""What the office's live map draws, in one call it polls every 15 seconds.

Riders on duty, and riders who went off duty within the last hour (so a rider
who clocked off mid-street does not simply vanish); the shops; and, for the
rider the office clicked on, their last half hour as a trail.

Only delivery users may ask. Everything is then read with sudo, because a
delivery user is not necessarily a Fleet or Inventory user, and the map is
the only thing this answer is for.
"""

from datetime import timedelta

from odoo import _, api, fields, models
from odoo.exceptions import AccessError

from odoo.addons.delivery_rider_rpc.models.rider_dispatch import _BUSY

# While the rider is on the way to the shop the next stop is the counter; from
# pickup onwards it is the customer's door.
_TO_SHOP = ('offered', 'accepted')
_RECENT_OFF_DUTY = timedelta(hours=1)
_TRAIL = timedelta(minutes=30)


class SaFleetMap(models.AbstractModel):
    _name = 'sa.fleet.map'
    _description = 'Fleet Live Map'

    @api.model
    def _check_access(self):
        if not self.env.user.has_group(
                'sales_automation_delivery.group_sa_delivery_user'):
            raise AccessError(_("Only delivery staff can open the live map."))

    @api.model
    def _point(self, partner):
        if partner and (partner.partner_latitude or partner.partner_longitude):
            return {'lat': partner.partner_latitude,
                    'lng': partner.partner_longitude}
        return None

    @api.model
    def _job_block(self, job):
        to_shop = job.sa_delivery_state in _TO_SHOP
        if to_shop:
            target = job.sa_shop_id._sa_fleet_point() if job.sa_shop_id else None
        else:
            target = self._point(job.partner_id)
        return {
            'id': job.id,
            'ref': job.sa_ref_code or job.name,
            'state': job.sa_delivery_state,
            'heading': 'shop' if to_shop else 'customer',
            'target': target,
            'target_name': (job.sa_shop_id.name if to_shop
                             else job.partner_id.name) or '',
        }

    @api.model
    def snapshot(self, rider_id=None):
        self._check_access()
        now = fields.Datetime.now()
        settings = self.env['sa.delivery.settings'].sudo().get_settings()
        stale_after = max(settings.fleet_fix_max_age_min or 10, 1) * 60

        Rider = self.env['sa.delivery.partner'].sudo()
        riders = Rider.search([
            '|', ('on_duty', '=', True),
            ('last_fix_on', '>=', now - _RECENT_OFF_DUTY),
        ])
        jobs = self.env['stock.picking'].sudo().search([
            ('sa_delivery_partner_id', 'in', riders.ids),
            ('sa_delivery_state', 'in', _BUSY),
        ], order='sa_delivery_partner_id, id')
        by_rider = {}
        for job in jobs:
            by_rider.setdefault(job.sa_delivery_partner_id.id, []).append(job)

        out_riders = []
        for rider in riders:
            located = bool(rider.last_fix_on and (rider.last_lat
                                                  or rider.last_lng))
            vehicle = rider.vehicle_id
            mine = by_rider.get(rider.id, [])
            out_riders.append({
                'id': rider.id,
                'name': rider.name,
                'kind': rider.kind,
                'on_duty': rider.on_duty,
                'lat': rider.last_lat if located else None,
                'lng': rider.last_lng if located else None,
                'fix_age_s': int((now - rider.last_fix_on).total_seconds())
                             if located else None,
                'battery': rider.last_battery or None,
                'vehicle': {'plate': vehicle.license_plate or vehicle.name,
                            'type': vehicle.vehicle_type or None}
                           if vehicle else None,
                'load': len(mine),
                'jobs': [self._job_block(j) for j in mine],
            })

        shops = []
        for shop in self.env['sa.delivery.shop'].sudo().search([]):
            point = shop._sa_fleet_point()
            if point:
                shops.append({'id': shop.id, 'name': shop.name, **point})

        trail = []
        if rider_id:
            trail = [{'lat': p.latitude, 'lng': p.longitude,
                      'at': fields.Datetime.to_string(p.recorded_on)}
                     for p in self.env['sa.fleet.position'].sudo().search([
                         ('rider_id', '=', int(rider_id)),
                         ('recorded_on', '>=', now - _TRAIL),
                     ], order='recorded_on asc, id asc')]

        return {
            'riders': out_riders,
            'shops': shops,
            'trail': trail,
            'stale_after_s': stale_after,
            'server_time': fields.Datetime.to_string(now),
        }
