from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.delivery_rider_rpc.tests.common import RiderRpcCase

# Two points in Muscat about 1.1 km apart, and one 10 m from the first.
A = (23.5880, 58.3829)
A_NEAR = (23.58809, 58.3829)
B = (23.5980, 58.3829)


@tagged('post_install', '-at_install')
class TestPositions(RiderRpcCase):
    """The on-duty heartbeat and delivery pings become position history."""

    def setUp(self):
        super().setUp()
        self.Position = self.env['sa.fleet.position'].sudo()
        self.Position.search([('rider_id', 'in', (self.rider | self.other).ids)]).unlink()
        self.rider.write({'on_duty': True})

    def _rows(self, rider=None):
        return self.Position.search([('rider_id', '=', (rider or self.rider).id)])

    def test_me_offers_location(self):
        self.assertIn('location', self.rpc().me()['fleet']['features'])

    def test_heartbeat_records_and_fills_last_seen(self):
        out = self.rpc().rider_location(latitude=A[0], longitude=A[1],
                                        battery=0.8, accuracy=12)
        self.assertTrue(out['success'])
        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows.latitude, A[0], places=5)
        self.assertEqual(rows.accuracy, 12)
        self.assertAlmostEqual(self.rider.last_lat, A[0], places=5)
        self.assertTrue(self.rider.last_fix_on)
        self.assertAlmostEqual(self.rider.last_battery, 0.8)

    def test_off_duty_records_nothing(self):
        self.rider.write({'on_duty': False})
        out = self.rpc().rider_location(latitude=A[0], longitude=A[1])
        self.assertFalse(out['success'])
        self.assertEqual(out['code'], 'off_duty')
        self.assertFalse(self._rows())

    def test_standing_still_adds_no_row(self):
        self.rpc().rider_location(latitude=A[0], longitude=A[1])
        self.rpc().rider_location(latitude=A_NEAR[0], longitude=A_NEAR[1])
        self.assertEqual(len(self._rows()), 1, "10 m is GPS wobble, not a move.")
        self.rpc().rider_location(latitude=B[0], longitude=B[1])
        self.assertEqual(len(self._rows()), 2)

    def test_bad_fix_is_ignored(self):
        self.rpc().rider_location(latitude='x', longitude=None)
        self.rpc().rider_location(latitude=0, longitude=0)
        self.assertFalse(self._rows())

    def test_delivery_ping_counts(self):
        job = self._new_job(state='out_for_delivery')
        out = self.rpc().ping(job.id, B[0], B[1], accuracy=5)
        self.assertTrue(out['success'])
        row = self._rows()
        self.assertEqual(len(row), 1)
        self.assertEqual(row.picking_id, job)
        self.assertAlmostEqual(self.rider.last_lat, B[0], places=5)

    def test_ping_outside_delivery_counts_for_nothing(self):
        job = self._new_job(state='accepted')
        out = self.rpc().ping(job.id, B[0], B[1])
        self.assertFalse(out['success'])
        self.assertFalse(self._rows())

    def test_batch_keeps_only_the_newest(self):
        job = self._new_job(state='out_for_delivery')
        self.rpc().ping_batch(job.id, [
            {'latitude': A[0], 'longitude': A[1]},
            {'latitude': B[0], 'longitude': B[1]},
        ])
        row = self._rows()
        self.assertEqual(len(row), 1)
        self.assertAlmostEqual(row.latitude, B[0], places=5)

    def test_vehicle_is_stamped_on_the_row(self):
        brand = self.env['fleet.vehicle.model.brand'].create({'name': 'Pos Moto'})
        model = self.env['fleet.vehicle.model'].create(
            {'name': 'P1', 'brand_id': brand.id, 'vehicle_type': 'bike'})
        bike = self.env['fleet.vehicle'].sudo().create(
            {'model_id': model.id, 'license_plate': 'POS 1', 'sa_rider_ok': True})
        self.rpc().take_vehicle(bike.id)
        self.rpc().rider_location(latitude=A[0], longitude=A[1])
        self.assertEqual(self._rows().vehicle_id, bike)

    def test_purge_forgets_old_positions(self):
        settings = self.env['sa.delivery.settings'].sudo().get_settings()
        settings.fleet_position_keep_days = 7
        now = fields.Datetime.now()
        old = self.Position.create({'rider_id': self.rider.id, 'latitude': A[0],
                                    'longitude': A[1],
                                    'recorded_on': now - timedelta(days=8)})
        new = self.Position.create({'rider_id': self.rider.id, 'latitude': B[0],
                                    'longitude': B[1],
                                    'recorded_on': now - timedelta(days=1)})
        self.Position._cron_purge()
        self.assertFalse(old.exists())
        self.assertTrue(new.exists())

        settings.fleet_position_keep_days = 0
        new.recorded_on = now - timedelta(days=400)
        self.Position._cron_purge()
        self.assertTrue(new.exists(), "0 keeps everything.")


@tagged('post_install', '-at_install')
class TestLiveMap(RiderRpcCase):
    """What the office's map is sent."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.office = new_test_user(
            cls.env, login='fleet_map_office',
            groups='base.group_user,sales_automation_delivery.group_sa_delivery_user')
        cls.shop.partner_id = cls.env['res.partner'].create({
            'name': 'Map Test Counter', 'partner_latitude': A[0],
            'partner_longitude': A[1]})
        cls.customer.write({'partner_latitude': B[0], 'partner_longitude': B[1]})

    def setUp(self):
        super().setUp()
        Rider = self.env['sa.delivery.partner'].sudo()
        Rider.search([('id', 'not in', (self.rider | self.other).ids)]).write(
            {'on_duty': False, 'last_fix_on': False})
        (self.rider | self.other).write({'on_duty': True, 'last_fix_on': False})

    def _snap(self, **kw):
        return self.env['sa.fleet.map'].with_user(self.office).snapshot(**kw)

    def _row(self, snap, rider):
        return next(r for r in snap['riders'] if r['id'] == rider.id)

    def test_riders_cannot_open_the_map(self):
        with self.assertRaises(AccessError):
            self.env['sa.fleet.map'].with_user(self.rider_user).snapshot()

    def test_riders_shops_and_positions(self):
        self.rpc().rider_location(latitude=A[0], longitude=A[1])
        snap = self._snap()
        mine = self._row(snap, self.rider)
        self.assertAlmostEqual(mine['lat'], A[0], places=5)
        self.assertLessEqual(mine['fix_age_s'], 5)
        self.assertEqual(mine['load'], 0)
        other = self._row(snap, self.other)
        self.assertIsNone(other['lat'], "Never reported: no position.")
        self.assertIn(self.shop.id, [s['id'] for s in snap['shops']])

    def test_stale_rider_is_older_than_the_limit(self):
        self.rpc().rider_location(latitude=A[0], longitude=A[1])
        self.rider.sudo().last_fix_on = fields.Datetime.now() - timedelta(minutes=30)
        snap = self._snap()
        self.assertGreater(self._row(snap, self.rider)['fix_age_s'],
                           snap['stale_after_s'])

    def test_next_stop_follows_the_job(self):
        to_shop = self._new_job(state='accepted')
        on_road = self._new_job(state='out_for_delivery')
        jobs = {j['id']: j for j in self._row(self._snap(), self.rider)['jobs']}
        self.assertEqual(jobs[to_shop.id]['heading'], 'shop')
        self.assertAlmostEqual(jobs[to_shop.id]['target']['lat'], A[0], places=5)
        self.assertEqual(jobs[on_road.id]['heading'], 'customer')
        self.assertAlmostEqual(jobs[on_road.id]['target']['lat'], B[0], places=5)

    def test_trail_for_the_selected_rider(self):
        self.rpc().rider_location(latitude=A[0], longitude=A[1])
        self.rpc().rider_location(latitude=B[0], longitude=B[1])
        self.assertEqual(self._snap()['trail'], [])
        trail = self._snap(rider_id=self.rider.id)['trail']
        self.assertEqual(len(trail), 2)
        self.assertAlmostEqual(trail[-1]['lat'], B[0], places=5)

    def test_off_duty_rider_seen_lately_stays_on_the_map(self):
        self.rpc().rider_location(latitude=A[0], longitude=A[1])
        self.rider.write({'on_duty': False})
        row = self._row(self._snap(), self.rider)
        self.assertFalse(row['on_duty'])
