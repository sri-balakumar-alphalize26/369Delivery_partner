from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from odoo.addons.delivery_rider_rpc.tests.common import RiderRpcCase


@tagged('post_install', '-at_install')
class TestNotifications(RiderRpcCase):
    """"Parcel ready" and "offer about to expire" reach the rider's phone."""

    def setUp(self):
        super().setUp()
        Device = self.env['sa.rider.device'].sudo()
        Device.search([('rider_id', '=', self.rider.id)]).unlink()
        Device.create({'rider_id': self.rider.id, 'token': 'ExpoToken[notif]'})
        self.settings = self.env['sa.delivery.settings'].sudo().get_settings()
        self.settings.rider_rpc_offer_timeout_min = 5

    def _pushes(self, job):
        return self._outbox(job).filtered(lambda r: r.channel == 'push')

    def _titles(self, job):
        return [r.payload for r in self._pushes(job)]

    # --------------------------------------------------------- ready

    def _has_store(self):
        return 'sa_shop_ready_on' in self.env['stock.picking']._fields

    def test_offer_after_packing_says_it_is_ready(self):
        if not self._has_store():
            self.skipTest("No store module - nothing is ever packed.")
        job = self._new_job(state='offered')
        job.sa_shop_ready_on = fields.Datetime.now()
        before = len(self._pushes(job))
        job._rider_rpc_push(self.rider)
        new = self._pushes(job)[before:]
        self.assertEqual(len(new), 1)
        self.assertIn('ready to collect', new.payload)
        self.assertIn(self.shop.name, new.body)

    def test_accepted_job_hears_when_packed(self):
        if not self._has_store():
            self.skipTest("No store module - nothing is ever packed.")
        job = self._new_job(state='accepted')
        before = len(self._pushes(job))
        job.sa_shop_ready_on = fields.Datetime.now()
        new = self._pushes(job)[before:]
        self.assertEqual(len(new), 1)
        self.assertIn('Parcel ready', new.payload)
        job.sa_shop_ready_on = fields.Datetime.now()
        self.assertEqual(len(self._pushes(job)), before + 1,
                         "Packed once: told once.")

    # ------------------------------------------------------ reminder

    def _offered(self, minutes_ago):
        job = self._new_job(state='offered')
        job.sa_offered_on = fields.Datetime.now() - timedelta(minutes=minutes_ago)
        return job

    def _reminders(self, job):
        return [p for p in self._titles(job) if '1 minute left' in (p or '')]

    def test_reminded_once_a_minute_before(self):
        job = self._offered(4.5)
        self.env['stock.picking']._cron_fleet_offer_reminder()
        self.assertEqual(len(self._reminders(job)), 1)
        self.env['stock.picking']._cron_fleet_offer_reminder()
        self.assertEqual(len(self._reminders(job)), 1, "Not twice.")

    def test_not_reminded_early(self):
        job = self._offered(2)
        self.env['stock.picking']._cron_fleet_offer_reminder()
        self.assertFalse(self._reminders(job))

    def test_no_reminder_without_room(self):
        for minutes in (0, 1):
            self.settings.rider_rpc_offer_timeout_min = minutes
            job = self._offered(0.5)
            self.env['stock.picking']._cron_fleet_offer_reminder()
            self.assertFalse(self._reminders(job))

    def test_a_new_offer_is_reminded_again(self):
        job = self._offered(4.5)
        job.sa_offer_reminded_on = fields.Datetime.now() - timedelta(minutes=10)
        self.env['stock.picking']._cron_fleet_offer_reminder()
        self.assertEqual(len(self._reminders(job)), 1,
                         "The old reminder was for an earlier offer.")
