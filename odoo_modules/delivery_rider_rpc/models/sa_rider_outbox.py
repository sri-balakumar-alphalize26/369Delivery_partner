"""Messages a rider's tap caused, sent after the tap has been answered.

Why a queue at all: `sa_set_state()` sends its WhatsApp messages inline, so a
rider pressing "Picked up" waited on the gateway - and a gateway that hung
held the rider's request, and the row lock on the job, for as long as it
hung. From the app the step is now a database write; the message follows a
few seconds later from the cron.

What is queued is the *call*, not a description of it: the session, the
method (`send_message` / `sa_send_text_mentioning`), the number and the exact
text the delivery module composed. The cron makes that same call. So every
override on the way - the store module's "say it in the group", the 369 Mart
bridge silencing website orders - has already had its say before the row is
written, and nothing here second-guesses them.

Rows are written in the rider's own transaction. A request that rolls back
(a serialization retry, a validation error at "delivered") leaves no row, so
nothing is ever sent about a step that did not happen.
"""

import json
import logging
from datetime import timedelta

import requests

from odoo import _, api, fields, models
from odoo.modules import module as odoo_module
from odoo.tools import SQL

from odoo.addons.whatsapp_gateway.models.whatsapp_session import (
    WhatsAppBlocked, WhatsAppQueued)

_logger = logging.getLogger(__name__)

# Minutes to wait before attempt n+1. Five attempts cover a bit over an hour -
# long enough for a phone to be re-paired, short enough that "on the way" is
# not delivered the next morning.
BACKOFF = (1, 2, 5, 15, 60)
MAX_ATTEMPTS = len(BACKOFF)

EXPO_URL = 'https://exp.host/--/api/v2/push/send'

# The two doors the delivery flow sends through. Anything else is refused
# rather than getattr'd - the method name comes from a database row.
_WA_METHODS = ('send_message', 'sa_send_text_mentioning')


class SaRiderOutbox(models.Model):
    _name = 'sa.rider.outbox'
    _description = 'Rider App Outbox'
    _order = 'id'

    channel = fields.Selection(
        [('whatsapp', 'WhatsApp'), ('push', 'App push')],
        required=True, default='whatsapp')
    picking_id = fields.Many2one(
        'stock.picking', string='Delivery', index=True, ondelete='cascade',
        help="Messages for one delivery go out strictly in the order they "
             "were queued.")
    session_id = fields.Many2one('whatsapp.session', ondelete='cascade')
    method = fields.Char(help="The whatsapp.session method to call.")
    recipient = fields.Char(
        required=True, help="Phone, group JID, or Expo push token.")
    body = fields.Text(required=True)
    mention = fields.Char()
    payload = fields.Text(help="JSON data carried by an app push.")

    state = fields.Selection([
        ('queued', 'Queued'),
        ('sent', 'Sent'),
        ('handed_off', 'Queued by the gateway'),
        ('blocked', 'Blocked'),
        ('failed', 'Failed'),
    ], default='queued', required=True, index=True)
    attempts = fields.Integer(default=0)
    next_try = fields.Datetime(default=fields.Datetime.now, index=True)
    sent_on = fields.Datetime()
    last_error = fields.Text()

    # ------------------------------------------------------------ queueing

    @api.model
    def _enqueue(self, vals):
        """Queue one message and wake the sender."""
        vals = dict(vals)
        vals.setdefault('picking_id',
                        self.env.context.get('rider_rpc_picking_id') or False)
        row = self.sudo().create(vals)
        self._wake()
        return row

    @api.model
    def _wake(self):
        # The trigger row is part of this transaction: it exists only if the
        # rider's step committed, and Odoo notifies the cron workers after
        # the commit.
        cron = self.env.ref('delivery_rider_rpc.cron_rider_outbox_send',
                            raise_if_not_found=False)
        if cron:
            cron.sudo()._trigger()

    # ------------------------------------------------------------- sending

    @api.model
    def _cron_send(self, limit=100):
        """Send what is due, oldest first, one delivery's rows in order.

        Several passes: a row held back behind an older one of the same
        delivery becomes due the moment that one is sent, and should not
        wait a minute for the next run to notice.
        """
        total = 0
        for _pass in range(10):
            done = self._send_due(limit)
            total += done
            if not done:
                break
        return total

    @api.model
    def _send_due(self, limit):
        now = fields.Datetime.now()
        self.flush_model()
        # A row waits while an older row of the same delivery is still
        # queued: a retried "on the way" must not arrive after "delivered".
        self.env.cr.execute(SQL("""
            SELECT o.id FROM sa_rider_outbox o
             WHERE o.state = 'queued' AND o.next_try <= %(now)s
               AND NOT EXISTS (
                   SELECT 1 FROM sa_rider_outbox e
                    WHERE e.state = 'queued'
                      AND e.picking_id = o.picking_id
                      AND e.id < o.id)
             ORDER BY o.id
             LIMIT %(limit)s
             FOR UPDATE OF o SKIP LOCKED
        """, now=now, limit=limit))
        ids = [row[0] for row in self.env.cr.fetchall()]
        rows = self.sudo().browse(ids)
        for row in rows:
            row._send_one()
            self._commit()
        return len(rows)

    def _send_one(self):
        self.ensure_one()
        refused = None
        try:
            with self.env.cr.savepoint():
                # These two are caught *inside* the savepoint: the gateway
                # writes its own 'pending' / 'blocked' log row before raising
                # them, and rolling that back would lose the message.
                try:
                    if self.channel == 'push':
                        self._send_push()
                        ok = True
                    else:
                        ok = self._send_whatsapp()
                except (WhatsAppQueued, WhatsAppBlocked) as err:
                    refused = err
        except Exception as err:  # noqa: BLE001 - the queue must keep moving
            self._retry_later(err)
            return
        if isinstance(refused, WhatsAppQueued):
            # The gateway kept it as 'pending' and retries it itself once the
            # number is connected again. Sending it again here would deliver
            # it twice.
            self._settle('handed_off', str(refused))
            return
        if isinstance(refused, WhatsAppBlocked):
            # Refused on policy (opt-out, daily cap). Retrying is how a
            # policy gets worn down.
            self._settle('blocked', str(refused))
            return
        if ok:
            self._settle('sent')
        else:
            # send_message answers False when WhatsApp is switched off for
            # the session or the number is blocked - not a transient fault.
            self._settle('blocked', _("The gateway declined to send it."))

    def _send_whatsapp(self):
        if self.method not in _WA_METHODS:
            raise ValueError("Unknown send method %r" % self.method)
        session = self.session_id.sudo().with_context(rider_rpc_sending=True)
        if not session:
            raise ValueError("The WhatsApp session is gone.")
        if self.method == 'sa_send_text_mentioning':
            return session.sa_send_text_mentioning(
                self.recipient, self.body, self.mention or '')
        return session.send_message(self.recipient, self.body)

    def _send_push(self):
        # 'jobs' is the Android channel the app creates at full importance.
        # Without the channel id the OS may show no heads-up banner at all.
        message = {'to': self.recipient, 'sound': 'default',
                   'body': self.body, 'priority': 'high',
                   'channelId': 'jobs'}
        data = json.loads(self.payload or '{}')
        title = data.pop('title', None)
        if title:
            message['title'] = title
        if data:
            message['data'] = data
        answer = self._expo_post([message])
        ticket = (answer.get('data') or [{}])[0]
        if ticket.get('status') == 'error':
            details = ticket.get('details') or {}
            if details.get('error') == 'DeviceNotRegistered':
                # The app was uninstalled or the token rotated. Forget it so
                # the next job does not try it again.
                self.env['sa.rider.device'].sudo().search(
                    [('token', '=', self.recipient)]).write({'active': False})
                raise WhatsAppBlocked(ticket.get('message') or 'unregistered')
            raise RuntimeError(ticket.get('message') or 'Expo refused it')

    @api.model
    def _expo_post(self, messages):
        """One call to Expo's push service. Mocked in the tests."""
        response = requests.post(EXPO_URL, json=messages, timeout=10, headers={
            'Accept': 'application/json', 'Content-Type': 'application/json'})
        response.raise_for_status()
        return response.json()

    def _settle(self, state, error=False):
        self.write({'state': state, 'last_error': error or False,
                    'attempts': self.attempts + 1,
                    'sent_on': fields.Datetime.now()})

    def _retry_later(self, err):
        attempts = self.attempts + 1
        if attempts >= MAX_ATTEMPTS:
            self.write({'state': 'failed', 'attempts': attempts,
                        'last_error': str(err)[:1000]})
            if self.picking_id:
                self.picking_id.sudo().message_post(body=_(
                    "A message to %(to)s could not be sent after %(n)s "
                    "attempts: %(why)s",
                    to=self.recipient, n=attempts, why=str(err)[:200]))
            _logger.warning("Rider outbox: gave up on #%s to %s: %s",
                            self.id, self.recipient, err)
            return
        wait = BACKOFF[attempts - 1]
        self.write({
            'attempts': attempts,
            'last_error': str(err)[:1000],
            'next_try': fields.Datetime.now() + timedelta(minutes=wait),
        })
        cron = self.env.ref('delivery_rider_rpc.cron_rider_outbox_send',
                            raise_if_not_found=False)
        if cron:
            cron.sudo()._trigger(self.next_try)
        _logger.info("Rider outbox: #%s to %s failed (%s), retry in %s min",
                     self.id, self.recipient, err, wait)

    @api.model
    def _commit(self):
        # One row per commit, so a crash half way through a batch never
        # sends the first half again. Not inside a test's transaction.
        if not odoo_module.current_test:
            self.env['ir.cron']._commit_progress(1)

    # ------------------------------------------------------------- buttons

    def action_retry(self):
        self.write({'state': 'queued', 'attempts': 0, 'last_error': False,
                    'next_try': fields.Datetime.now()})
        self._wake()
        return True

    # ------------------------------------------------------------- cleanup

    @api.autovacuum
    def _gc_sent(self):
        """Settled rows are an audit trail for a month, then noise."""
        limit = fields.Datetime.now() - timedelta(days=30)
        self.sudo().search([('state', 'in', ('sent', 'handed_off')),
                            ('create_date', '<', limit)]).unlink()
