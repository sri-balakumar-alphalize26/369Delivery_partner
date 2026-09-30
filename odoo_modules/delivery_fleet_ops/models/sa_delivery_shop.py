"""Where a shop is: the pickup pin.

The rider app, the live map and dispatch all ask the same question, so they
all ask here. The first place that knows wins:

1. the shop's own contact;
2. its warehouse's 369 Mart location (`mart369_lat` / `mart369_lng`), read
   only when that module is installed - this one does not depend on it;
3. the warehouse's address contact.
"""

from odoo import _, fields, models
from odoo.exceptions import UserError


def _partner_point(partner):
    if partner and (partner.partner_latitude or partner.partner_longitude):
        return {'lat': partner.partner_latitude,
                'lng': partner.partner_longitude}
    return None


class SaDeliveryShop(models.Model):
    _inherit = 'sa.delivery.shop'

    sa_pickup_lat = fields.Float(
        'Pickup Latitude', digits=(10, 7), compute='_compute_sa_pickup')
    sa_pickup_lng = fields.Float(
        'Pickup Longitude', digits=(10, 7), compute='_compute_sa_pickup')
    sa_pickup_known = fields.Boolean(compute='_compute_sa_pickup')

    def _compute_sa_pickup(self):
        for shop in self:
            point = shop._sa_fleet_point()
            shop.sa_pickup_known = bool(point)
            shop.sa_pickup_lat = point['lat'] if point else 0.0
            shop.sa_pickup_lng = point['lng'] if point else 0.0

    def _sa_fleet_point(self):
        self.ensure_one()
        shop = self.sudo()
        point = _partner_point(shop.partner_id)
        if point:
            return point
        warehouse = shop.warehouse_id
        if not warehouse:
            return None
        if 'mart369_lat' in warehouse._fields and (
                warehouse.mart369_lat or warehouse.mart369_lng):
            return {'lat': warehouse.mart369_lat,
                    'lng': warehouse.mart369_lng}
        return _partner_point(warehouse.partner_id)

    def action_fleet_locate(self):
        """Put the shop on the map from its contact's address."""
        self.ensure_one()
        if not self.partner_id:
            raise UserError(_(
                "Set a Contact with the shop's address first - that is where "
                "riders are sent to pick up."))
        if not self.partner_id._sa_geocode():
            raise UserError(_(
                "Could not find \"%s\" on the map. Check the street and city "
                "on the contact, or type its latitude and longitude there.",
                self.partner_id.contact_address.replace('\n', ', ')
                if self.partner_id.contact_address else self.partner_id.name))
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'type': 'success',
                'message': _("%s is on the map now.", self.name),
                # Redraw the form so the pickup pin shows at once.
                'next': {'type': 'ir.actions.client', 'tag': 'soft_reload'},
            },
        }
