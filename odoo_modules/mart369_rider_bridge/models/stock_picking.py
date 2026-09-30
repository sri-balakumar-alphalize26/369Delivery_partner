"""Packed at the counter calls the least busy rider on duty.

`sales_automation_store` calls, at Packed, the rider picked when the order was
confirmed - or nobody, when nobody was on duty then, and the job is "left to
dispatch by hand" even with riders clocked on by now. Packing can be hours
after confirming, so the rider picked then is also a poor guess at who is
free.

So Packed picks again, with `delivery_rider_rpc`'s least-busy rule and minus
the riders who already passed on the job. A rider a person chose is kept:
`rider_rpc_hand_picked` tells the two apart, set by `write` whenever the rider
changes without the `rider_rpc_auto` context the automatic paths carry
(dispatch_context.py).
"""

import logging

from odoo import _, fields, models

_logger = logging.getLogger(__name__)


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    rider_rpc_hand_picked = fields.Boolean(
        'Rider Chosen by Hand', copy=False,
        help="A person chose this job's rider, so Packed keeps them instead "
             "of calling the least busy rider on duty.")

    def write(self, vals):
        if 'sa_delivery_partner_id' in vals:
            vals = dict(vals, rider_rpc_hand_picked=bool(
                vals['sa_delivery_partner_id'])
                and not self.env.context.get('rider_rpc_auto'))
        return super().write(vals)

    def sa_shop_ready(self):
        Rider = self.env['sa.delivery.partner'].sudo()
        picked = {}
        for picking in self:
            if (picking.sa_delivery_state not in ('awaiting_shop', 'preparing')
                    or picking.rider_rpc_hand_picked):
                continue
            new = Rider.with_context(
                rider_rpc_exclude=picking.rider_rpc_passed_ids.ids,
            )._sa_pick_for(picking.sa_shop_id)
            if not new:
                # Nobody on duty: the parent leaves it in To Dispatch, and
                # the first rider to clock on sweeps it up.
                continue
            old = picking.sa_delivery_partner_id
            if new != old:
                _logger.info("369 Mart rider bridge: %s packed - %s instead "
                             "of %s", picking.sa_ref_code, new.name,
                             old.name or 'nobody')
                picking.with_context(rider_rpc_auto=True).write(
                    {'sa_delivery_partner_id': new.id})
                if old:
                    # The job sat on their list as AT SHOP/PACKING; without
                    # this it would just vanish at their next refresh.
                    picking._rider_rpc_push_gone(old)
            picked[picking.id] = new

        result = super().sa_shop_ready()

        for picking in self.filtered(lambda p: p.id in picked):
            rider = picked[picking.id]
            if (picking.sa_delivery_state == 'offered'
                    and picking.sa_delivery_partner_id == rider):
                picking.message_post(body=_(
                    "Packed - offered to %s, the least busy rider on duty.",
                    rider.name))
        return result
