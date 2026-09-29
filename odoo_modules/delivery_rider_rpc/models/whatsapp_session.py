"""The one place a rider-app step turns "send now" into "send soon".

Every message the delivery flow sends - to the customer, the WhatsApp group,
the shop's pickup code, the rider - ends in one of these two calls. Catching
them here rather than in `_sa_tell_customer` and friends means every override
above them (the store module's group redirect, the bridge's silence for
website orders) has already decided *whether* and *where*; this only decides
*when*.

Only calls made under `rider_rpc_queue` are caught, and `sa.rider.rpc` is the
only thing that sets it. Backend buttons, the WhatsApp flow and the existing
`/api/delivery` routes send inline exactly as before.
"""

from odoo import models


class WhatsAppSession(models.Model):
    _inherit = 'whatsapp.session'

    def _rider_rpc_should_queue(self):
        ctx = self.env.context
        return ctx.get('rider_rpc_queue') and not ctx.get('rider_rpc_sending')

    def send_message(self, phone, message):
        if not self._rider_rpc_should_queue():
            return super().send_message(phone, message)
        self.ensure_one()
        self.env['sa.rider.outbox']._enqueue({
            'session_id': self.id, 'method': 'send_message',
            'recipient': phone, 'body': message,
        })
        return True

    def sa_send_text_mentioning(self, phone, message, mention):
        if not self._rider_rpc_should_queue():
            return super().sa_send_text_mentioning(phone, message, mention)
        self.ensure_one()
        self.env['sa.rider.outbox']._enqueue({
            'session_id': self.id, 'method': 'sa_send_text_mentioning',
            'recipient': phone, 'body': message, 'mention': mention or '',
        })
        return True
