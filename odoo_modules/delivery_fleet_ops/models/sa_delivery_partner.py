"""The vehicle a rider has out, and the one they usually take.

A rider gives the vehicle back whenever `on_duty` goes off - through the app,
`sa_set_duty()`, or the office's on-duty switch in the riders list, which
writes the field directly. That is why it is done in `write()`.
"""

from odoo import _, fields, models


class SaDeliveryPartner(models.Model):
    _inherit = 'sa.delivery.partner'

    vehicle_id = fields.Many2one(
        'fleet.vehicle', string='Riding', readonly=True, copy=False,
        index='btree_not_null',
        help="The vehicle this rider took when they clocked on. Given back "
             "when they clock off.")
    default_vehicle_id = fields.Many2one(
        'fleet.vehicle', string='Usual Vehicle', copy=False,
        domain=[('sa_rider_ok', '=', True)],
        help="Picked for them in the app when they clock on, if it is free.")

    _vehicle_once = models.UniqueIndex(
        '(vehicle_id) WHERE vehicle_id IS NOT NULL',
        "That vehicle is already out with another rider.")

    def write(self, vals):
        res = super().write(vals)
        if 'on_duty' in vals and not vals['on_duty']:
            self._sa_fleet_release()
        return res

    def action_fleet_live_map(self):
        """The live map, with this rider selected and their trail drawn."""
        self.ensure_one()
        return {
            'type': 'ir.actions.client',
            'tag': 'delivery_fleet_ops.live_map',
            'name': _('Live Map'),
            'context': {'rider_id': self.id},
        }

    def _sa_fleet_partner(self):
        """The contact Fleet shows as Driver."""
        self.ensure_one()
        return self.partner_id or self.user_id.partner_id

    def _sa_fleet_vehicles(self):
        """What this rider may take now: rider vehicles, not grounded, not
        out with somebody else. The one they already have is included."""
        self.ensure_one()
        return self.env['fleet.vehicle'].sudo().search([
            ('sa_rider_ok', '=', True),
            ('sa_grounded', '=', False),
            '|', ('sa_rider_id', '=', False), ('sa_rider_id', '=', self.id),
        ], order='name, id')

    def _sa_fleet_take(self, vehicle):
        """Hand `vehicle` to this rider, giving back the one they had."""
        self.ensure_one()
        if self.vehicle_id == vehicle:
            return
        self.sudo().write({'vehicle_id': vehicle.id})
        vehicle._sa_hand_to(self)

    def _sa_fleet_release(self):
        """Give the vehicle back. Fleet's Driver stays - it is who rode it
        last, and changes only when somebody else takes it."""
        self.sudo().filtered('vehicle_id').write({'vehicle_id': False})
