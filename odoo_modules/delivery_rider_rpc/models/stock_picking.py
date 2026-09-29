"""Tell the rider's phone when their list of work changes under them.

The app polls every ten seconds while it is open; a push is for when it is
not. Two moments matter: a job arrives (offered), and a job is taken away by
somebody else (cancelled, or turned round to `returning` by a manager). A
rider's own taps never push - they are looking at the screen.
"""

import json

from odoo import _, models

_PUSH_ON = ('offered', 'cancelled', 'returning')


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def write(self, vals):
        new_state = vals.get('sa_delivery_state')
        if new_state not in _PUSH_ON or self.env.context.get('rider_rpc_queue'):
            return super().write(vals)
        before = {p.id: (p.sa_delivery_state, p.sa_delivery_partner_id)
                  for p in self}
        result = super().write(vals)
        for picking in self:
            state, rider = before[picking.id]
            if state != picking.sa_delivery_state:
                picking._rider_rpc_push(picking.sa_delivery_partner_id or rider)
        return result

    def _rider_rpc_push(self, rider):
        self.ensure_one()
        devices = rider.sudo().rider_rpc_device_ids if rider else False
        if not devices:
            return
        state = self.sa_delivery_state
        ref = self.sa_ref_code or self.name
        if state == 'offered':
            title = _("New delivery #%s", ref)
            body = _("%(n)s item(s) for %(customer)s. Open to accept.",
                     n=len(self.move_ids),
                     customer=self.partner_id.name or _("a customer"))
        else:
            title = _("Delivery #%s changed", ref)
            body = (_("Cancelled - bring the parcel back to the shop.")
                    if state == 'returning'
                    else _("Cancelled - no need to collect it."))
        self._rider_rpc_push_devices(devices, title, body, state)

    def _rider_rpc_push_gone(self, rider):
        """The offer left this rider - they declined, or it ran out."""
        self.ensure_one()
        devices = rider.sudo().rider_rpc_device_ids if rider else False
        if not devices:
            return
        ref = self.sa_ref_code or self.name
        self._rider_rpc_push_devices(
            devices, _("Delivery #%s moved on", ref),
            _("It was offered to another rider."), 'passed')

    def _rider_rpc_push_devices(self, devices, title, body, status):
        payload = json.dumps({'title': title, 'delivery_order_id': self.id,
                              'status': status})
        Outbox = self.env['sa.rider.outbox']
        for device in devices:
            Outbox._enqueue({'channel': 'push', 'picking_id': self.id,
                             'recipient': device.token, 'body': body,
                             'payload': payload})

    def _sa_job_body(self):
        """The rider's WhatsApp job message, without the reply command.

        The parent ends with "(or reply *#CODE ACCEPT*)", but nothing reads a
        rider's reply - a rider who trusted it was left waiting on an offer
        they believed they had taken. The link and the app are the two ways
        in, so the message says so.
        """
        body = super()._sa_job_body()
        dead = _("(or reply *#%(code)s ACCEPT*)", code=self.sa_ref_code or '')
        if dead in body:
            body = body.replace(dead, _("(or open it in the rider app)"))
        return body
