"""Two more moments worth a push to the rider's phone.

* **Parcel ready.** In the 369 Mart store flow, pressing Packed is what offers
  the job, so the offer itself now says it is packed and where. In a flow where
  the rider accepted first and the shop packs later, the rider gets a separate
  "Parcel ready" when the packing time is set - no more riding to a counter
  that has nothing for them yet.
* **Offer about to expire.** One minute before an unanswered offer passes to
  the next rider (Delivery Settings > Offer Timeout), a reminder - once per
  offer.

Both go through `delivery_rider_rpc`'s own outbox, like every other push.
"""

import logging
from datetime import timedelta

from odoo import _, api, fields, models

_logger = logging.getLogger(__name__)


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    sa_offer_reminded_on = fields.Datetime(
        'Offer Reminder Sent', readonly=True, copy=False)

    # ============================================================ ready

    def _sa_fleet_packed(self):
        """When the shop packed it, or False (or no store module at all)."""
        return 'sa_shop_ready_on' in self._fields and self.sa_shop_ready_on

    def _rider_rpc_push(self, rider):
        """A new offer for a parcel already packed says so."""
        self.ensure_one()
        if self.sa_delivery_state != 'offered' or not self._sa_fleet_packed():
            return super()._rider_rpc_push(rider)
        devices = rider.sudo().rider_rpc_device_ids if rider else False
        if not devices:
            return
        ref = self.sa_ref_code or self.name
        self._rider_rpc_push_devices(
            devices,
            _("New delivery #%s - ready to collect", ref),
            _("Packed at %(shop)s. %(n)s item(s) for %(customer)s. "
              "Open to accept.", shop=self.sa_shop_id.name or _("the shop"),
              n=len(self.move_ids),
              customer=self.partner_id.name or _("a customer")),
            'offered')

    def write(self, vals):
        watch = bool(vals.get('sa_shop_ready_on')) and \
            'sa_shop_ready_on' in self._fields
        unpacked = {p.id for p in self if not p.sa_shop_ready_on} if watch \
            else set()
        res = super().write(vals)
        for job in self:
            if job.id in unpacked and job.sa_delivery_state == 'accepted':
                job._sa_fleet_push_ready()
        return res

    def _sa_fleet_push_ready(self):
        """The rider already has this job; the shop has now packed it."""
        rider = self.sa_delivery_partner_id
        devices = rider.sudo().rider_rpc_device_ids if rider else False
        if not devices:
            return
        ref = self.sa_ref_code or self.name
        self._rider_rpc_push_devices(
            devices, _("Parcel ready #%s", ref),
            _("%s has packed it. Go and collect.",
              self.sa_shop_id.name or _("The shop")),
            'ready')

    # ========================================================= reminder

    @api.model
    def _cron_fleet_offer_reminder(self):
        """One minute before an offer runs out, remind the rider once."""
        minutes = self.env['sa.delivery.settings'].sudo().get_settings() \
            .rider_rpc_offer_timeout_min
        if not minutes or minutes < 2:
            return 0            # no timeout, or no room to warn before it
        now = fields.Datetime.now()
        due = self.sudo().search([
            ('sa_delivery_state', '=', 'offered'),
            ('sa_offered_on', '<=', now - timedelta(minutes=minutes - 1)),
            ('sa_offered_on', '>', now - timedelta(minutes=minutes)),
        ])
        sent = 0
        for job in due:
            if job.sa_offer_reminded_on and \
                    job.sa_offer_reminded_on >= job.sa_offered_on:
                continue        # this offer was already reminded
            try:
                with self.env.cr.savepoint():
                    job._sa_fleet_push_reminder()
                    job.sa_offer_reminded_on = now
                    sent += 1
            except Exception:  # noqa: BLE001 - one job must not stop the rest
                _logger.exception("Fleet: could not remind the rider of %s",
                                  job.sa_ref_code)
        return sent

    def _sa_fleet_push_reminder(self):
        rider = self.sa_delivery_partner_id
        devices = rider.sudo().rider_rpc_device_ids if rider else False
        if not devices:
            return
        ref = self.sa_ref_code or self.name
        self._rider_rpc_push_devices(
            devices, _("Accept #%s - 1 minute left", ref),
            _("Otherwise it goes to another rider."), 'offered')
