from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import RiderRpcCase

# The keys the app's DeliveryOrder type reads (src/api/types.ts).
APP_ORDER_KEYS = {
    'delivery_order_id', 'delivery_order_name', 'job_code', 'sales_order',
    'customer_name', 'customer_mobile', 'delivery_address', 'shop',
    'items_summary', 'products', 'payment_status', 'amount_to_collect',
    'currency', 'delivery_status', 'delivery_type', 'promised_by',
    'allowed_actions', 'latitude', 'longitude', 'tracking', 'timestamps',
}


@tagged('post_install', '-at_install')
class TestRiderRpc(RiderRpcCase):

    def test_happy_path_offered_to_delivered(self):
        job = self._new_job(cod=7.0)
        rpc = self.rpc()

        listed = rpc.orders()
        self.assertEqual([o['delivery_order_id'] for o in listed['orders']],
                         [job.id])
        self.assertEqual(listed['counts']['assigned'], 1)
        self.assertEqual(listed['orders'][0]['allowed_actions'], ['accept'])

        detail = rpc.order(job.id)['order']
        self.assertTrue(APP_ORDER_KEYS <= set(detail), APP_ORDER_KEYS - set(detail))
        self.assertEqual(detail['payment_status'], 'cod')
        self.assertEqual(detail['amount_to_collect'], 7.0)

        self.assertEqual(rpc.accept(job.id)['status'], 'accepted')

        arrived = rpc.arrived(job.id, 'shop')
        self.assertTrue(arrived['success'])
        pickup_code = arrived['otp_debug']
        self.assertEqual(rpc.verify_pickup(job.id, pickup_code)['status'],
                         'picked')
        self.assertEqual(rpc.dispatch(job.id)['status'], 'dispatched')

        started = rpc.start(job.id)
        self.assertEqual(started['status'], 'out_for_delivery')
        self.assertTrue(started['tracking']['enabled'])
        delivery_code = started['otp_debug']

        done = rpc.verify_delivery(job.id, delivery_code)
        self.assertEqual(done['status'], 'delivered')
        self.assertEqual(done['allowed_actions'], [])
        self.assertTrue(done['delivered_at'])
        self.assertEqual(job.state, 'done',
                         "Delivered must validate the picking, as the "
                         "backend button does.")
        self.assertEqual(rpc.orders()['orders'], [])
        self.assertEqual(rpc.history()['history'][0]['status'], 'delivered')

    def test_steps_queue_whatsapp_instead_of_sending(self):
        job = self._new_job()
        self.rpc().accept(job.id)
        self.assertEqual(self.wa_sent, [],
                         "The rider's tap must not wait on the gateway.")
        rows = self._outbox(job)
        self.assertEqual(rows.mapped('recipient'), ['+96890002222'])
        self.assertIn('RPC Rider', rows.body)
        self.assertEqual(rows.state, 'queued')

        self._send()
        self.assertEqual(rows.state, 'sent')
        self.assertEqual(len(self.wa_sent), 1)
        self.assertIn('RPC Rider', self.wa_sent[0][1])

    def test_backend_buttons_still_send_inline(self):
        job = self._new_job()
        job.action_sa_accepted()
        self.assertEqual(len(self.wa_sent), 1)
        self.assertFalse(self._outbox(job))

    def test_another_riders_job_is_not_found(self):
        job = self._new_job(rider=self.other)
        rpc = self.rpc()
        self.assertEqual(rpc.order(job.id)['code'], 'not_found')
        self.assertEqual(rpc.accept(job.id)['code'], 'not_found')
        self.assertEqual(rpc.ping(job.id, 23.5, 58.4)['code'], 'not_found')
        self.assertEqual(job.sa_delivery_state, 'offered')
        self.assertNotIn(job.id, [o['delivery_order_id']
                                  for o in rpc.orders()['orders']])

    def test_refusals_are_answers_not_errors(self):
        job = self._new_job()
        rpc = self.rpc()
        wrong = rpc.dispatch(job.id)
        self.assertFalse(wrong['success'])
        self.assertEqual(wrong['code'], 'wrong_state')
        self.assertEqual(wrong['status'], 'offered')
        self.assertEqual(wrong['allowed_actions'], ['accept'])

        rpc.accept(job.id)
        rpc.arrived(job.id, 'shop')
        bad = rpc.verify_pickup(job.id, '000000')
        self.assertEqual(bad['code'], 'bad_otp')
        self.assertEqual(job.sa_delivery_state, 'accepted')

        self.assertEqual(rpc.arrived(job.id, 'moon')['code'], 'bad_point')

    def test_replay_runs_once(self):
        job = self._new_job()
        rpc = self.rpc()
        first = rpc.accept(job.id, client_uuid='tap-1')
        again = rpc.accept(job.id, client_uuid='tap-1')
        self.assertTrue(first['success'])
        self.assertTrue(again['success'])
        self.assertTrue(again['replayed'])
        self.assertEqual(len(self._outbox(job)), 1,
                         "A replay must not message the customer twice.")
        # A new uuid is a new action - and this one is now out of order.
        self.assertEqual(rpc.accept(job.id, client_uuid='tap-2')['code'],
                         'wrong_state')

    def test_uuid_reused_for_another_job_is_refused(self):
        """Found live: a replayed answer for job A must not be handed back as
        if job B had been accepted."""
        first, second = self._new_job(), self._new_job()
        rpc = self.rpc()
        self.assertTrue(rpc.accept(first.id, client_uuid='same')['success'])
        answer = rpc.accept(second.id, client_uuid='same')
        self.assertEqual(answer['code'], 'uuid_reused')
        self.assertEqual(second.sa_delivery_state, 'offered')

    def test_refused_answers_are_not_replayed(self):
        job = self._new_job(state='accepted')
        rpc = self.rpc()
        code = rpc.arrived(job.id, 'shop')['otp_debug']
        self.assertEqual(
            rpc.verify_pickup(job.id, '000000', client_uuid='u1')['code'],
            'bad_otp')
        self.assertTrue(
            rpc.verify_pickup(job.id, code, client_uuid='u1')['success'])

    def test_user_not_linked_to_a_rider_is_refused(self):
        stranger = self.env['res.users'].create({
            'name': 'Not A Rider', 'login': 'not.a.rider@test',
            'group_ids': [(6, 0, [self.env.ref('base.group_portal').id])],
        })
        with self.assertRaises(AccessError):
            self.rpc(stranger).orders()

    def test_duty_and_location(self):
        rpc = self.rpc()
        self.assertTrue(rpc.set_duty(True)['on_duty'])
        answer = rpc.rider_location(23.58, 58.38, 0.8)
        self.assertEqual(answer['poll_after_seconds'], 120)
        self.assertAlmostEqual(self.rider.last_lat, 23.58)
        self.assertFalse(rpc.set_duty(False)['on_duty'])
        self.assertEqual(rpc.rider_location(1, 1)['code'], 'off_duty')

    def test_ping_only_while_on_the_road(self):
        job = self._new_job(state='dispatched')
        rpc = self.rpc()
        self.assertTrue(rpc.ping(job.id, 23.5, 58.4)['stop'])
        rpc.start(job.id)
        self.assertFalse(rpc.ping(job.id, 23.5, 58.4)['stop'])
        batch = rpc.ping_batch(job.id, [
            {'latitude': 23.51, 'longitude': 58.41},
            {'latitude': 23.52, 'longitude': 58.42},
        ])
        self.assertEqual(batch['stored'], 2)
        self.assertAlmostEqual(job.sa_rider_lat, 23.52)

    def test_return_to_shop(self):
        job = self._new_job(state='out_for_delivery')
        rpc = self.rpc()
        answer = rpc.return_to_shop(job.id, 'nobody home')
        self.assertEqual(answer['status'], 'returning')
        self.assertEqual(job.sa_cancel_reason, 'nobody home')
        self.assertEqual(rpc.confirm_return(job.id)['status'], 'returned')

    def test_proof_and_issue(self):
        job = self._new_job(state='out_for_delivery')
        rpc = self.rpc()
        saved = rpc.upload_proof(job.id, 'data:image/jpeg;base64,/9j/4AAQ')
        self.assertTrue(saved['success'])
        self.assertEqual(rpc.upload_proof(job.id, '')['code'], 'no_file')
        self.assertTrue(rpc.report_issue(job.id, 'gate locked')['success'])
        self.assertEqual(job.sa_last_error, 'gate locked')

    def test_create_login_makes_a_portal_user(self):
        user = self.rider_user
        self.assertEqual(user.login, '96890003333')
        self.assertTrue(user.share, "A rider login must not open the backend.")
        self.assertIn(self.env.ref('delivery_rider_rpc.group_rider_app'),
                      user.group_ids)
        self.assertEqual(self.rpc().me()['rider']['id'], self.rider.id)
