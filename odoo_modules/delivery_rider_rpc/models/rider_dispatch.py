"""Who gets a job, and what happens when they do not take it.

The delivery module offers every job to the first rider on duty, in the order
own riders, then sequence, then id - so with three riders clocked on, the one
at the top of the list gets all the work and the other two get none. It also
has no way for an offer to end: a rider who never answers holds the job until
somebody in the office notices.

Three changes, all by inheritance - nothing in `sales_automation_*` is edited:

* **least busy first.** Among the riders on duty for the shop, own riders
  still come first, but within them the one with the fewest open jobs wins.
  Sequence only breaks a tie.
* **passing it on.** A rider who declines, or lets the offer run out, is
  remembered on the job and it goes to the next rider on duty. With nobody
  left it goes back to To Dispatch, and whoever clocks on next takes it -
  unless they are one of the riders who already passed.
* **no offer to an empty chair.** Under the store flow the rider is chosen
  when the order is confirmed but only called when the shop has packed it,
  which can be hours later. A rider who clocked off in between is skipped.
"""

import logging
from datetime import timedelta

from odoo import _, api, fields, models

_logger = logging.getLogger(__name__)

# What counts as a rider being busy. `open_count` on the rider stops at
# `picked`, which would call a rider with three parcels on the road idle.
_BUSY = ('offered', 'accepted', 'picked', 'dispatched', 'out_for_delivery')


class SaDeliveryPartner(models.Model):
    _inherit = 'sa.delivery.partner'

    @api.model
    def _sa_pick_for(self, shop):
        """The parent's filter - on duty, serves this shop - ordered by load.

        `rider_rpc_exclude` in the context names riders who already passed on
        the job being placed, so it is never offered back to them.
        """
        riders = self.sudo().search([('on_duty', '=', True)])
        exclude = self.env.context.get('rider_rpc_exclude') or []
        if exclude:
            riders = riders.filtered(lambda r: r.id not in exclude)
        if shop:
            riders = riders.filtered(
                lambda r: not r.shop_ids or shop in r.shop_ids)
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
                                          r.sequence, r.id))

    def _sa_waiting_jobs(self):
        """What clocking on sweeps up, minus the jobs this rider passed on."""
        jobs = super()._sa_waiting_jobs()
        return jobs.filtered(lambda p: self not in p.rider_rpc_passed_ids)


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    rider_rpc_passed_ids = fields.Many2many(
        'sa.delivery.partner', 'rider_rpc_picking_passed_rel',
        'picking_id', 'rider_id', string='Passed On By', copy=False,
        help="Riders who declined this job or let the offer run out. It is "
             "never offered back to them.")

    def sa_action_offer(self):
        """Re-pick a rider who clocked off before the job was ready."""
        for picking in self:
            rider = picking.sa_delivery_partner_id
            if not rider or rider.on_duty or picking.sa_delivery_state not in (
                    'none', False, 'to_assign', 'ready', 'awaiting_shop',
                    'preparing'):
                continue
            new = self.env['sa.delivery.partner'].with_context(
                rider_rpc_exclude=picking.rider_rpc_passed_ids.ids,
            )._sa_pick_for(picking.sa_shop_id)
            _logger.info("Rider RPC: %s was for %s, who is off duty - now %s",
                         picking.sa_ref_code, rider.name,
                         new.name if new else 'nobody')
            picking.sa_delivery_partner_id = new
        return super().sa_action_offer()

    def _rider_rpc_pass_on(self, reason):
        """This rider will not take it: offer it to the next one, or park it.

        Returns the rider it went to, or an empty recordset when it went back
        to To Dispatch.
        """
        self.ensure_one()
        before = self.sa_delivery_partner_id
        passed = self.rider_rpc_passed_ids | before
        new = self.env['sa.delivery.partner'].with_context(
            rider_rpc_exclude=passed.ids)._sa_pick_for(self.sa_shop_id)

        why = (_("declined by %s", before.name) if reason == 'declined'
               else _("not accepted by %s in time", before.name))
        self.write({'rider_rpc_passed_ids': [(6, 0, passed.ids)],
                    'sa_delivery_partner_id': new.id or False})
        if new:
            # Forced: the parent's guard remembers this job was offered in the
            # last fifteen minutes and would swallow the offer to `new`.
            self.with_context(sa_force_offer=True).sa_action_offer()
            # Still `offered`, so the state hook in stock_picking.py saw no
            # change and pushed nothing.
            self._rider_rpc_push(new)
            note = _("Offer %(why)s - passed to %(new)s.", why=why,
                     new=new.name)
        else:
            self.write({'sa_delivery_state': 'to_assign',
                        'sa_last_error': _("Offer %(why)s, and no other "
                                           "rider is on duty.", why=why)})
            note = _("Offer %(why)s - no other rider on duty, back to To "
                     "Dispatch.", why=why)
        if before:
            self._rider_rpc_push_gone(before)
        self.message_post(body=note)
        _logger.info("Rider RPC: job %s %s", self.sa_ref_code, note)
        return new

    @api.model
    def _cron_rider_rpc_offer_timeout(self):
        """Take back offers nobody answered, and hand them on."""
        settings = self.env['sa.delivery.settings'].sudo().get_settings()
        minutes = settings.rider_rpc_offer_timeout_min
        if not minutes or minutes <= 0:
            return 0
        cutoff = fields.Datetime.now() - timedelta(minutes=minutes)
        stale = self.sudo().search([('sa_delivery_state', '=', 'offered'),
                                    ('sa_offered_on', '<', cutoff)])
        moved = 0
        for job in stale:
            try:
                with self.env.cr.savepoint():
                    job._rider_rpc_pass_on('timeout')
                    moved += 1
            except Exception:  # noqa: BLE001 - one bad job must not stop the rest
                _logger.exception("Rider RPC: could not pass on job %s",
                                  job.sa_ref_code)
        return moved
