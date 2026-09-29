from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import RiderRpcCase


@tagged('post_install', '-at_install')
class TestRiderDispatch(RiderRpcCase):
    """Who gets a job, declining it, offers that run out, and the counters."""

    def setUp(self):
        super().setUp()
        Rider = self.env['sa.delivery.partner'].sudo()
        # Riders already in the database must not win the pick.
        Rider.search([('id', 'not in', (self.rider | self.other).ids)]).write(
            {'on_duty': False})
        (self.rider | self.other).write({'on_duty': True, 'sequence': 10})
        self.settings = self.env['sa.delivery.settings'].sudo().get_settings()
        self.settings.rider_rpc_offer_timeout_min = 5
        Device = self.env['sa.rider.device'].sudo()
        Device.search([('rider_id', 'in', (self.rider | self.other).ids)]).unlink()
        Device.create({'rider_id': self.rider.id, 'token': 'ExpoToken[rider]'})
        Device.create({'rider_id': self.other.id, 'token': 'ExpoToken[other]'})

    def _pick(self):
        return self.env['sa.delivery.partner']._sa_pick_for(self.shop)

    # ---------------------------------------------------------- least busy

    def test_least_busy_rider_gets_the_job(self):
        self._new_job(state='accepted')
        self._new_job(state='out_for_delivery')
        self.assertEqual(self._pick(), self.other,
                         "The rider with two parcels must not get a third "
                         "while a colleague has none.")

    def test_sequence_breaks_a_tie(self):
        self.other.sequence = 1
        self.assertEqual(self._pick(), self.other)
        self.other.sequence = 20
        self.assertEqual(self._pick(), self.rider)

    def test_own_riders_before_outside_couriers(self):
        self.other.kind = 'third_party'
        self._new_job(state='accepted')
        self.assertEqual(self._pick(), self.rider,
                         "Own riders still come first, however busy.")

    # ------------------------------------------------------------- decline

    def test_decline_passes_the_job_on(self):
        job = self._new_job()
        answer = self.rpc().decline(job.id, 'too far', client_uuid='d-1')
        self.assertTrue(answer['success'])
        self.assertTrue(answer['removed'])
        self.assertEqual(job.sa_delivery_partner_id, self.other)
        self.assertEqual(job.sa_delivery_state, 'offered')
        self.assertIn(self.rider, job.rider_rpc_passed_ids)
        pushed = self._outbox(job).filtered(lambda r: r.channel == 'push')
        self.assertEqual(set(pushed.mapped('recipient')),
                         {'ExpoToken[rider]', 'ExpoToken[other]'},
                         "The new rider hears of the offer, the old one that "
                         "it has gone.")
        self.assertNotIn(job.id, [o['delivery_order_id']
                                  for o in self.rpc().orders()['orders']])
        self.assertIn(job.id, [o['delivery_order_id'] for o in
                               self.rpc(self.other_user).orders()['orders']])
        again = self.rpc().decline(job.id, 'too far', client_uuid='d-1')
        self.assertTrue(again['replayed'])

    def test_decline_with_nobody_left_goes_to_dispatch(self):
        self.other.on_duty = False
        job = self._new_job()
        self.assertTrue(self.rpc().decline(job.id)['success'])
        self.assertEqual(job.sa_delivery_state, 'to_assign')
        self.assertFalse(job.sa_delivery_partner_id)
        self.assertTrue(job.sa_last_error)

    def test_decline_only_your_own_new_offer(self):
        theirs = self._new_job(rider=self.other)
        self.assertEqual(self.rpc().decline(theirs.id)['code'], 'not_found')
        taken = self._new_job(state='accepted')
        self.assertEqual(self.rpc().decline(taken.id)['code'], 'wrong_state')
        self.assertEqual(taken.sa_delivery_partner_id, self.rider)

    def test_a_passed_job_is_not_swept_back(self):
        job = self._new_job()
        self.other.on_duty = False
        self.rpc().decline(job.id)
        self.assertEqual(job.sa_delivery_state, 'to_assign')
        self.rider.on_duty = False
        self.rpc().set_duty(True)
        self.assertFalse(job.sa_delivery_partner_id,
                         "Clocking on must not hand back a declined job.")
        self.rpc(self.other_user).set_duty(True)
        self.assertEqual(job.sa_delivery_partner_id, self.other)
        self.assertEqual(job.sa_delivery_state, 'offered')

    # ------------------------------------------------------------- timeout

    def test_unanswered_offer_moves_on(self):
        stale, fresh = self._new_job(), self._new_job()
        stale.write({'sa_offered_on':
                     fields.Datetime.now() - timedelta(minutes=10)})
        fresh.write({'sa_offered_on': fields.Datetime.now()})
        Picking = self.env['stock.picking']
        self.assertGreaterEqual(Picking._cron_rider_rpc_offer_timeout(), 1)
        self.assertEqual(stale.sa_delivery_partner_id, self.other)
        self.assertEqual(fresh.sa_delivery_partner_id, self.rider)

    def test_timeout_zero_is_off(self):
        self.settings.rider_rpc_offer_timeout_min = 0
        job = self._new_job()
        job.write({'sa_offered_on':
                   fields.Datetime.now() - timedelta(hours=3)})
        self.assertEqual(
            self.env['stock.picking']._cron_rider_rpc_offer_timeout(), 0)
        self.assertEqual(job.sa_delivery_partner_id, self.rider)

    def test_off_duty_rider_is_skipped_when_the_job_is_offered(self):
        job = self._new_job(state='to_assign')
        self.rider.on_duty = False
        job.sa_action_offer()
        self.assertEqual(job.sa_delivery_partner_id, self.other)
        self.assertEqual(job.sa_delivery_state, 'offered')

    # ------------------------------------------------------------ counters

    def test_delivered_counts_today_only(self):
        today = self._new_job(state='delivered')
        today.write({'sa_delivered_on': fields.Datetime.now()})
        old = self._new_job(state='delivered')
        old.write({'sa_delivered_on':
                   fields.Datetime.now() - timedelta(days=2)})
        self.assertEqual(self.rpc().orders()['counts']['delivered'], 1)

    def test_shop_states_count_as_assigned(self):
        states = dict(self.env['stock.picking']._fields[
            'sa_delivery_state'].selection)
        if 'awaiting_shop' not in states:
            self.skipTest("The store module is not installed.")
        self._new_job(state='awaiting_shop')
        listed = self.rpc().orders()
        self.assertEqual(listed['counts']['assigned'], 1)
        self.assertEqual(listed['orders'][0]['allowed_actions'], [])

    # ---------------------------------------------------------- pickup code

    def test_pickup_code_stands_for_a_minute(self):
        job = self._new_job(state='accepted')
        rpc = self.rpc()
        code = rpc.arrived(job.id, 'shop')['otp_debug']
        again = rpc.request_pickup_otp(job.id)
        self.assertTrue(again['success'])
        self.assertFalse(again['resent'])
        self.assertGreater(again['retry_after_seconds'], 0)
        self.assertNotIn('otp_debug', again)
        self.assertEqual(rpc.verify_pickup(job.id, code)['status'], 'picked',
                         "The code the shop already has must still work.")

    # --------------------------------------------------------------- guard

    def test_guard_claim_is_given_back_on_rollback(self):
        released = []
        Guard = self.env['sa.outbox.guard']
        callbacks = self.env.cr.postrollback
        before = len(callbacks._funcs)
        with patch.object(type(Guard), 'release',
                          lambda self, key: released.append(key)):
            Guard.with_context(
                rider_rpc_queue=True)._rider_rpc_release_on_rollback('k-1')
            self.assertEqual(len(callbacks._funcs), before + 1)
            callbacks._funcs.pop()()
        self.assertEqual(released, ['k-1'])

    # ------------------------------------------------------ login and text

    def test_create_login_refuses_an_office_user(self):
        self.env['res.users'].create({
            'name': 'Office Clerk', 'login': '96890005555',
            'group_ids': [(6, 0, [self.env.ref('base.group_user').id])],
        })
        rider = self.env['sa.delivery.partner'].sudo().create({
            'name': 'Clashing Rider', 'phone': '96890005555', 'kind': 'own',
        })
        with self.assertRaises(UserError):
            rider.action_rider_rpc_create_login()
        self.assertFalse(rider.user_id)

    def test_job_message_has_no_reply_command(self):
        job = self._new_job()
        body = job._sa_job_body()
        self.assertNotIn('ACCEPT*', body)
        if job.sa_job_url:
            self.assertIn('rider app', body)
