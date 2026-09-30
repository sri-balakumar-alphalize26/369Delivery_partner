import json

from odoo.tests import tagged

from odoo.addons.delivery_rider_rpc.tests.common import RiderRpcCase


@tagged('post_install', '-at_install')
class TestPackedAssign(RiderRpcCase):
    """Packed at the counter calls the least busy rider on duty."""

    def setUp(self):
        super().setUp()
        Rider = self.env['sa.delivery.partner'].sudo()
        # Riders already in the database must not win the pick.
        Rider.search([('id', 'not in', (self.rider | self.other).ids)]).write(
            {'on_duty': False})
        (self.rider | self.other).write({'on_duty': True, 'sequence': 10})
        self.env['sa.delivery.settings'].sudo().get_settings() \
            .shop_confirms = True
        Device = self.env['sa.rider.device'].sudo()
        Device.search([('rider_id', 'in', (self.rider | self.other).ids)]).unlink()
        Device.create({'rider_id': self.rider.id, 'token': 'ExpoToken[rider]'})
        Device.create({'rider_id': self.other.id, 'token': 'ExpoToken[other]'})

    def _packing(self, rider=None, hand_picked=False):
        """A job at the counter, being packed, with `rider` saved on it."""
        job = self._new_job(state='preparing')
        job.with_context(rider_rpc_auto=not hand_picked).write(
            {'sa_delivery_partner_id': rider.id if rider else False})
        return job

    def _pushed_to(self, job):
        return self._outbox(job).filtered(
            lambda r: r.channel == 'push').mapped('recipient')

    def test_no_rider_saved_gets_one_on_duty(self):
        self.rider.on_duty = False
        job = self._packing()
        job.sa_shop_ready()
        self.assertEqual(job.sa_delivery_state, 'offered')
        self.assertEqual(job.sa_delivery_partner_id, self.other)
        self.assertFalse(job.rider_rpc_hand_picked)
        self.assertEqual(self._pushed_to(job), ['ExpoToken[other]'])

    def test_stale_pick_goes_to_the_least_busy(self):
        self._new_job(state='accepted')     # `rider` is carrying a parcel
        job = self._packing(self.rider)
        job.sa_shop_ready()
        self.assertEqual(job.sa_delivery_partner_id, self.other,
                         "The pick made at confirming is only a guess.")
        self.assertEqual(job.sa_delivery_state, 'offered')

    def test_the_rider_it_left_is_told(self):
        self._new_job(state='accepted')
        job = self._packing(self.rider)
        job.sa_shop_ready()
        gone = self._outbox(job).filtered(
            lambda r: r.channel == 'push' and r.recipient == 'ExpoToken[rider]')
        self.assertEqual(len(gone), 1,
                         "The job was on their list; it must not just vanish.")
        self.assertEqual(json.loads(gone.payload)['status'], 'passed')

    def test_the_app_is_told_when_it_was_packed_and_by_whom(self):
        self.rider.on_duty = False
        job = self._packing()
        job.sa_shop_ready()
        listed = {o['delivery_order_id']: o for o in
                  self.rpc(self.other_user).orders()['orders']}[job.id]
        self.assertTrue(listed['packed_at'].endswith('Z'))
        self.assertEqual(listed['assigned_by'], 'auto')

        waiting = self._packing(self.other, hand_picked=True)
        shown = self.rpc(self.other_user).order(waiting.id)['order']
        self.assertIsNone(shown['packed_at'])
        self.assertEqual(shown['assigned_by'], 'office')

    def test_hand_picked_rider_is_kept(self):
        self._new_job(state='accepted')
        job = self._packing(self.rider, hand_picked=True)
        self.assertTrue(job.rider_rpc_hand_picked)
        job.sa_shop_ready()
        self.assertEqual(job.sa_delivery_partner_id, self.rider,
                         "A rider a person chose must not be swapped.")
        self.assertEqual(job.sa_delivery_state, 'offered')

    def test_nobody_on_duty_waits_for_the_next_to_clock_on(self):
        (self.rider | self.other).write({'on_duty': False})
        job = self._packing()
        job.sa_shop_ready()
        self.assertEqual(job.sa_delivery_state, 'to_assign')
        self.rpc(self.other_user).set_duty(True)
        self.assertEqual(job.sa_delivery_partner_id, self.other)
        self.assertEqual(job.sa_delivery_state, 'offered')
        self.assertFalse(job.rider_rpc_hand_picked)

    def test_a_rider_who_passed_is_not_called(self):
        self._new_job(state='accepted', rider=self.other)
        job = self._packing()
        job.rider_rpc_passed_ids = self.rider
        job.sa_shop_ready()
        self.assertEqual(job.sa_delivery_partner_id, self.other,
                         "Busier, but the only rider who has not passed.")

    def test_passing_on_is_not_hand_picking(self):
        job = self._new_job(state='offered')
        self.assertTrue(self.rpc().decline(job.id)['success'])
        self.assertEqual(job.sa_delivery_partner_id, self.other)
        self.assertFalse(job.rider_rpc_hand_picked)
