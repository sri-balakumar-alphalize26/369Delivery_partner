from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from odoo.addons.delivery_rider_rpc.models.sa_rider_outbox import MAX_ATTEMPTS

from .common import RiderRpcCase


@tagged('post_install', '-at_install')
class TestRiderOutbox(RiderRpcCase):

    def _due_now(self, rows):
        rows.write({'next_try': fields.Datetime.now() - timedelta(seconds=1)})

    def test_gateway_queue_is_not_retried_by_us(self):
        """The gateway keeps an unreachable send as 'pending' and retries it
        itself. Retrying here as well would deliver it twice."""
        job = self._new_job()
        self.rpc().accept(job.id)
        self.gateway['mode'] = 'queued'
        self._send()
        row = self._outbox(job)
        self.assertEqual(row.state, 'handed_off')
        self.assertEqual(row.attempts, 1)

    def test_policy_block_is_final(self):
        job = self._new_job()
        self.rpc().accept(job.id)
        self.gateway['mode'] = 'blocked'
        self._send()
        self.assertEqual(self._outbox(job).state, 'blocked')

    def test_errors_back_off_then_fail(self):
        job = self._new_job()
        self.rpc().accept(job.id)
        row = self._outbox(job)
        self.gateway['mode'] = 'error'

        self._send()
        self.assertEqual((row.state, row.attempts), ('queued', 1))
        self.assertGreater(row.next_try, fields.Datetime.now())
        self._send()
        self.assertEqual(row.attempts, 1, "Not due yet - must not be tried.")

        for _attempt in range(MAX_ATTEMPTS - 1):
            self._due_now(row)
            self._send()
        self.assertEqual(row.state, 'failed')
        self.assertIn('socket closed', row.last_error)
        self.assertIn('could not be sent', job.message_ids[0].body)

        # The office presses Retry once the number is back.
        self.gateway['mode'] = 'ok'
        row.action_retry()
        self._send()
        self.assertEqual(row.state, 'sent')

    def test_one_delivery_in_order(self):
        """A retried "picked up" must not arrive after "on the way"."""
        job = self._new_job(state='accepted')
        rpc = self.rpc()
        code = rpc.arrived(job.id, 'shop')['otp_debug']
        self.gateway['mode'] = 'error'
        self._send()                      # the pickup code to the shop fails
        self.gateway['mode'] = 'ok'
        rpc.verify_pickup(job.id, code)   # queues "collected"
        self._send()
        first, second = self._outbox(job)
        self.assertEqual(first.state, 'queued')
        self.assertEqual(second.state, 'queued',
                         "Held back behind the older message.")
        self._due_now(first)
        self._send()
        self.assertEqual((first.state, second.state), ('sent', 'sent'))
        self.assertIn('Pickup code', self.wa_sent[0][1])

    def test_rolled_back_step_leaves_nothing(self):
        job = self._new_job()
        with self.assertRaises(ZeroDivisionError):
            with self.env.cr.savepoint():
                self.rpc().accept(job.id)
                1 / 0
        self.env.invalidate_all()
        self.assertFalse(self._outbox(job))
        self.assertEqual(job.sa_delivery_state, 'offered')

    def test_push_when_a_job_arrives_or_is_taken_away(self):
        rpc = self.rpc()
        # Exactly what the app sends, EAS project id included: an extra
        # field must never break registration.
        rpc.register_push('ExponentPushToken[abc]', 'android',
                          project_id='40359567-3ad0-4ff8-896a-8e45c92f0a7b')
        rpc.register_push('ExponentPushToken[abc]', 'android')  # harmless
        self.assertEqual(len(self.rider.rider_rpc_device_ids), 1)

        job = self._new_job()                      # offered from the backend
        push = self._outbox(job).filtered(lambda r: r.channel == 'push')
        self.assertEqual(len(push), 1)
        self._send()
        self.assertEqual(self.expo_sent[0]['to'], 'ExponentPushToken[abc]')
        self.assertEqual(self.expo_sent[0]['data']['delivery_order_id'], job.id)
        self.assertEqual(self.expo_sent[0]['channelId'], 'jobs',
                         "The app's Android channel, or no banner shows.")

        rpc.accept(job.id)                          # own tap: no push
        self.assertEqual(len(self._outbox(job).filtered(
            lambda r: r.channel == 'push')), 1)

        job.sa_action_cancel('customer changed their mind')
        self.assertEqual(len(self._outbox(job).filtered(
            lambda r: r.channel == 'push')), 2)

    def test_uninstalled_app_stops_getting_pushes(self):
        self.rpc().register_push('ExponentPushToken[old]')
        self.gateway['expo'] = 'unregistered'
        job = self._new_job()
        self._send()
        push = self._outbox(job).filtered(lambda r: r.channel == 'push')
        self.assertEqual(push.state, 'blocked')
        self.assertFalse(self.rider.rider_rpc_device_ids)
