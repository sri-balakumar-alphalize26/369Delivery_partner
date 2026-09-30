"""What a delivery learns on the way: pins, distances, a photo.

* Offering a job looks the customer's address up when they have no pin, so
  the rider's map has somewhere to draw the road to. It never holds the offer
  up: a failed lookup is tried again by the ten-minute cron.
* The note on the offer says how far the rider was from the shop, so the
  office can see why the job went to them.
* The distances at "arrived" and the doorstep photo are kept on the job.
"""

import logging
import time

from odoo import _, api, fields, models, modules

from .geo import metres_between, say_distance

_logger = logging.getLogger(__name__)

_ACTIVE = ('offered', 'accepted', 'picked', 'dispatched', 'out_for_delivery')


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    sa_arrived_shop_distance_m = fields.Integer(
        'Arrived at Shop From (m)', readonly=True, copy=False,
        help="How far from the shop the rider was when they tapped Arrived.")
    sa_arrived_customer_distance_m = fields.Integer(
        'Arrived at Customer From (m)', readonly=True, copy=False)
    sa_proof_attachment_id = fields.Many2one(
        'ir.attachment', string='Delivery Photo', readonly=True, copy=False)
    sa_proof_image = fields.Binary(
        'Photo at the Door', related='sa_proof_attachment_id.datas')

    def sa_tracking_enabled(self):
        """From accept, not only from Start delivery, when Settings say so.

        The customer already gets their tracking link at accept ("X is
        bringing your order - follow it live"), and the page already counts
        accepted, picked and dispatched as live; it only had no positions,
        because the app is told to send them only while this is true.
        """
        if super().sa_tracking_enabled():
            return True
        return (self.sa_delivery_state in ('accepted', 'picked', 'dispatched')
                and self.env['sa.delivery.settings'].sudo().get_settings()
                .fleet_track_from_accept)

    def sa_action_offer(self):
        res = super().sa_action_offer()
        for job in self.filtered(lambda p: p.sa_delivery_state == 'offered'):
            job._sa_fleet_offer_note()
            job._sa_fleet_pin_customer()
        return res

    def _sa_fleet_offer_note(self):
        rider = self.sa_delivery_partner_id
        point = self.sa_shop_id._sa_fleet_point() if self.sa_shop_id else None
        if not (rider and point and rider.sudo()._sa_fleet_fresh_fix()):
            return
        metres = metres_between(rider.last_lat, rider.last_lng,
                                point['lat'], point['lng'])
        if metres is not None:
            self.message_post(body=_("Offered to %(rider)s, %(far)s from the "
                                     "shop.", rider=rider.name,
                                     far=say_distance(metres)))

    def _sa_fleet_pin_customer(self):
        partner = self.partner_id
        if not partner or partner._sa_has_pin():
            return
        # Tests must never reach the internet; base_geolocalize does the same.
        if modules.module.current_test and not self.env.context.get(
                'sa_force_geocode'):
            return
        try:
            with self.env.cr.savepoint():
                partner.sudo()._sa_geocode()
        except Exception:  # noqa: BLE001 - the offer must go out regardless
            _logger.info("Fleet: pinning %s failed", partner.display_name,
                         exc_info=True)

    @api.model
    def _cron_fleet_geocode(self, limit=20):
        """Pin customers of jobs in hand, and shop contacts, still without."""
        jobs = self.sudo().search([('sa_delivery_state', 'in', _ACTIVE)])
        partners = jobs.mapped('partner_id') | self.env['sa.delivery.shop'] \
            .sudo().search([]).mapped('partner_id')
        todo = partners.filtered(lambda p: not p._sa_has_pin())[:limit]
        pinned = 0
        for i, partner in enumerate(todo):
            if i:
                time.sleep(1)  # OpenStreetMap asks for one request a second
            try:
                with self.env.cr.savepoint():
                    pinned += bool(partner._sa_geocode())
            except Exception:  # noqa: BLE001
                _logger.info("Fleet: geocoding %s failed", partner.display_name,
                             exc_info=True)
        return pinned
