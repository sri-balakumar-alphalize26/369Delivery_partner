"""Give a message's duplicate-guard claim back if the rider's step rolls back.

The guard commits its claim on a connection of its own, so the claim outlives
a rollback of the request that took it. Sent inline, that was harmless: the
message had already gone. Queued in `sa.rider.outbox`, it is not - the queued
row rolls back with the request, Odoo retries it, the retry finds the claim
still there and skips the message, and the customer never hears that their
parcel was collected.

`sa_action_offer` already hands its own claim back this way
(stock_picking_delivery.py). This does the same for every claim taken while a
rider-app step is running, which is the only time a message is queued.
"""

from odoo import models


class SaOutboxGuard(models.Model):
    _inherit = 'sa.outbox.guard'

    def claim(self, key, seconds=60):
        ok = super().claim(key, seconds)
        if ok and key and self.env.context.get('rider_rpc_queue'):
            self._rider_rpc_release_on_rollback(key)
        return ok

    def _rider_rpc_release_on_rollback(self, key):
        guard = self.sudo()
        self.env.cr.postrollback.add(lambda: guard.release(key))
