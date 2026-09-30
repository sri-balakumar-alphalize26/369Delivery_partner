"""The automatic ways a job gets its rider, marked as automatic.

Each only adds `rider_rpc_auto` to the context, so the rider it writes is not
taken for one a person chose (see `rider_rpc_hand_picked`). Anything else
that sets the rider - the job's form, the console's rider picker - counts as
chosen by hand.
"""

from odoo import models


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def _rider_rpc_pass_on(self, reason):
        """Declined, or the offer ran out."""
        return super(StockPicking, self.with_context(
            rider_rpc_auto=True))._rider_rpc_pass_on(reason)

    def sa_action_offer(self):
        """Re-picks a rider who clocked off. A rider set before a
        "Send again" was written before this runs, so it stays hand-picked."""
        return super(StockPicking, self.with_context(
            rider_rpc_auto=True)).sa_action_offer()


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    def _sa_dispatch_deliveries(self):
        """The pick made when the order is confirmed."""
        return super(SaleOrder, self.with_context(
            rider_rpc_auto=True))._sa_dispatch_deliveries()


class SaDeliveryPartner(models.Model):
    _inherit = 'sa.delivery.partner'

    def sa_set_duty(self, on_duty):
        """Clocking on sweeps up the jobs waiting in To Dispatch."""
        return super(SaDeliveryPartner, self.with_context(
            rider_rpc_auto=True)).sa_set_duty(on_duty)
