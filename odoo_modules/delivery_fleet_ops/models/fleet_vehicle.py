"""Which of the Fleet app's vehicles riders ride, and who has one now.

* **Rider Vehicle** marks the bikes and cars the app may offer. The manager's
  car stays out of the picker.
* **Ridden By** is the rider on duty with it. The rider's side
  (`sa.delivery.partner.vehicle_id`) is the one that is written, and carries
  the unique index; this is its mirror, stored so lists can filter on it.
* **Grounded** takes it out of the picker until somebody clears it.
"""

from odoo import api, fields, models


class FleetVehicle(models.Model):
    _inherit = 'fleet.vehicle'

    sa_rider_ok = fields.Boolean(
        'Rider Vehicle', tracking=True,
        help="Offered to riders in the app when they clock on.")
    sa_rider_ids = fields.One2many(
        'sa.delivery.partner', 'vehicle_id', string='Riders On It')
    sa_rider_id = fields.Many2one(
        'sa.delivery.partner', string='Ridden By',
        compute='_compute_sa_rider_id', store=True,
        help="The rider on duty with this vehicle now. Cleared when they "
             "clock off.")
    sa_grounded = fields.Boolean(
        'Grounded', tracking=True,
        help="Not offered to riders until this is cleared - for a vehicle "
             "that is broken, in service, or missing its papers.")

    @api.depends('sa_rider_ids')
    def _compute_sa_rider_id(self):
        for vehicle in self:
            vehicle.sa_rider_id = vehicle.sa_rider_ids[:1]

    def activity_schedule(self, *args, **kwargs):
        """No "Specify the End date" to-do when a rider takes the vehicle.

        Fleet asks the office for the last driver's end date on every change
        of driver. Riders swap bikes every shift, and `_sa_hand_to` closes the
        last driver's line itself, so the to-do would only pile up.
        """
        if self.env.context.get('sa_fleet_handover'):
            return self.env['mail.activity']
        return super().activity_schedule(*args, **kwargs)

    def _sa_hand_to(self, rider):
        """Make `rider` Fleet's Driver, closing the last driver's line.

        A rider with no contact behind them (no partner, no login) is not
        written as Driver - Fleet's driver is a contact - but still holds the
        vehicle.
        """
        partner = rider._sa_fleet_partner()
        if not partner:
            return
        Log = self.env['fleet.vehicle.assignation.log'].sudo()
        today = fields.Date.context_today(self)
        for vehicle in self.sudo():
            if vehicle.driver_id == partner:
                continue
            Log.search([('vehicle_id', '=', vehicle.id),
                        ('date_end', '=', False)]).write({'date_end': today})
            vehicle.with_context(sa_fleet_handover=True).write(
                {'driver_id': partner.id})
