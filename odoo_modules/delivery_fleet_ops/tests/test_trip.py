import base64
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import tagged

from odoo.addons.delivery_rider_rpc.tests.common import RiderRpcCase

# Muscat: the shop, a spot ~1.1 km north of it, one ~40 m away, and a door.
SHOP = (23.5880, 58.3829)
NEAR = (23.5883, 58.3829)
FAR = (23.5980, 58.3829)
DOOR = (23.6100, 58.4000)
PNG = base64.b64encode(
    b'\x89PNG\r\n\x1a\n' + b'\x00' * 64).decode()


class TripCase(RiderRpcCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings = cls.env['sa.delivery.settings'].sudo().get_settings()
        cls.shop.partner_id = cls.env['res.partner'].create({
            'name': 'Trip Test Counter', 'street': '1 Souq Road',
            'city': 'Muscat'})
        cls.shop.partner_id._sa_set_pin(*SHOP, 'manual')
        brand = cls.env['fleet.vehicle.model.brand'].create({'name': 'Trip Moto'})
        model = cls.env['fleet.vehicle.model'].create(
            {'name': 'T1', 'brand_id': brand.id, 'vehicle_type': 'bike'})
        Vehicle = cls.env['fleet.vehicle'].sudo()
        cls.bike = Vehicle.create({'model_id': model.id, 'license_plate': 'TRIP 1',
                                   'sa_rider_ok': True})
        cls.bike2 = Vehicle.create({'model_id': model.id, 'license_plate': 'TRIP 2',
                                    'sa_rider_ok': True})

    def setUp(self):
        super().setUp()
        Rider = self.env['sa.delivery.partner'].sudo()
        Rider.search([('id', 'not in', (self.rider | self.other).ids)]).write(
            {'on_duty': False})
        (self.rider | self.other).write(
            {'on_duty': True, 'sequence': 10, 'kind': 'own',
             'last_fix_on': False, 'last_lat': 0, 'last_lng': 0})
        self.settings.write({
            'fleet_vehicle_required': False, 'fleet_dispatch_max_km': 0,
            'fleet_arrive_radius_m': 150, 'fleet_arrive_enforce': 'warn',
            'fleet_proof_required': False, 'fleet_fix_max_age_min': 10})
        self.customer.write({'partner_latitude': 0, 'partner_longitude': 0})

    def _place(self, rider, point, minutes_ago=0):
        rider.sudo().write({
            'last_lat': point[0], 'last_lng': point[1],
            'last_fix_on': fields.Datetime.now() - timedelta(minutes=minutes_ago)})

    def _to_door(self, job, rpc):
        rpc.accept(job.id)
        code = rpc.arrived(job.id, 'shop')['otp_debug']
        rpc.verify_pickup(job.id, code)
        rpc.dispatch(job.id)
        return rpc.start(job.id)['otp_debug']


@tagged('post_install', '-at_install')
class TestPlaces(TripCase):
    """Shop and customer pins: the rider's map needs both ends."""

    def test_shop_pin_from_contact(self):
        self.assertAlmostEqual(self.shop._sa_fleet_point()['lat'], SHOP[0])

    def test_shop_pin_falls_back_to_warehouse_address(self):
        contact = self.shop.partner_id
        self.shop.partner_id = False
        wh = self.shop.warehouse_id
        if 'mart369_lat' in wh._fields:
            wh.write({'mart369_lat': 0, 'mart369_lng': 0})
        wh.partner_id.sudo()._sa_set_pin(23.6, 58.5, 'manual')
        self.assertAlmostEqual(self.shop._sa_fleet_point()['lat'], 23.6)
        self.shop.partner_id = contact

    def test_job_carries_the_pickup_pin(self):
        job = self._new_job()
        shop = self.rpc().order(job.id)['order']['shop']
        self.assertAlmostEqual(shop['latitude'], SHOP[0])

    def test_offer_pins_the_customer(self):
        self.customer.write({'street': '9 Test Street', 'city': 'Muscat'})
        job = self._new_job()
        with patch.object(type(self.env['base.geocoder']), 'geo_find',
                          return_value=DOOR):
            job.with_context(sa_force_geocode=True)._sa_fleet_pin_customer()
        self.assertAlmostEqual(self.customer.partner_latitude, DOOR[0])
        self.assertEqual(self.customer.sa_geo_source, 'geocoded')

    def test_failed_lookup_never_blocks(self):
        self.customer.write({'street': '9 Test Street', 'city': 'Muscat'})
        job = self._new_job()
        with patch.object(type(self.env['base.geocoder']), 'geo_find',
                          side_effect=RuntimeError('offline')):
            job.with_context(sa_force_geocode=True)._sa_fleet_pin_customer()
        self.assertFalse(self.customer.partner_latitude)

    def test_address_change_clears_the_pin_source(self):
        self.customer._sa_set_pin(*DOOR, 'geocoded')
        self.customer.write({'street': '10 Other Street'})
        self.assertFalse(self.customer.partner_latitude)
        self.assertFalse(self.customer.sa_geo_source)

    def test_office_typed_pin_is_manual(self):
        self.customer.write({'partner_latitude': DOOR[0],
                             'partner_longitude': DOOR[1]})
        self.assertEqual(self.customer.sa_geo_source, 'manual')

    def test_delivery_learns_the_door(self):
        self.customer._sa_set_pin(23.0, 58.0, 'geocoded')
        job = self._new_job()
        rpc = self.rpc()
        code = self._to_door(job, rpc)
        self._place(self.rider, DOOR)
        self.assertEqual(rpc.verify_delivery(job.id, code)['status'], 'delivered')
        self.assertAlmostEqual(self.customer.partner_latitude, DOOR[0])
        self.assertEqual(self.customer.sa_geo_source, 'doorstep')

    def test_manual_pin_is_never_moved(self):
        self.customer._sa_set_pin(23.0, 58.0, 'manual')
        job = self._new_job()
        rpc = self.rpc()
        code = self._to_door(job, rpc)
        self._place(self.rider, DOOR)
        rpc.verify_delivery(job.id, code)
        self.assertAlmostEqual(self.customer.partner_latitude, 23.0)

    def test_stale_fix_teaches_nothing(self):
        job = self._new_job()
        rpc = self.rpc()
        code = self._to_door(job, rpc)
        self._place(self.rider, DOOR, minutes_ago=30)
        rpc.verify_delivery(job.id, code)
        self.assertFalse(self.customer.partner_latitude)

    def test_cron_takes_at_most_the_limit(self):
        self.customer.write({'street': '9 Test Street', 'city': 'Muscat'})
        self._new_job()
        with patch.object(type(self.env['base.geocoder']), 'geo_find',
                          return_value=DOOR), \
                patch('time.sleep'):
            self.assertEqual(self.env['stock.picking']._cron_fleet_geocode(limit=1), 1)
        self.assertEqual(self.customer.sa_geo_source, 'geocoded')


@tagged('post_install', '-at_install')
class TestNearestRider(TripCase):
    """The next job goes to the nearest free rider."""

    def _pick(self):
        return self.env['sa.delivery.partner']._sa_pick_for(self.shop)

    def test_without_positions_the_old_order_holds(self):
        (self.rider | self.other).write({'sequence': 10})
        self.rider.sequence = 5
        self.assertEqual(self._pick(), self.rider)

    def test_nearest_free_rider_wins(self):
        self.rider.sequence = 5          # would win on sequence alone
        self._place(self.rider, FAR)
        self._place(self.other, NEAR)
        self.assertEqual(self._pick(), self.other)

    def test_free_still_beats_near_and_busy(self):
        self._place(self.rider, FAR)
        self._place(self.other, NEAR)
        self._new_job(rider=self.other, state='accepted')
        self.assertEqual(self._pick(), self.rider)

    def test_own_rider_before_courier(self):
        self.other.kind = 'third_party'
        self._place(self.rider, FAR)
        self._place(self.other, NEAR)
        self.assertEqual(self._pick(), self.rider)

    def test_stale_position_counts_as_unknown(self):
        self.rider.sequence = 5
        self._place(self.rider, FAR)
        self._place(self.other, NEAR, minutes_ago=60)
        self.assertEqual(self._pick(), self.rider)

    def test_max_distance_cuts_the_far_rider(self):
        self.settings.fleet_dispatch_max_km = 0.5
        self.other.on_duty = False
        self._place(self.rider, FAR)
        self.assertFalse(self._pick(), "1.1 km away with a 0.5 km limit.")

    def test_vehicle_required_skips_riders_without_one(self):
        self.settings.fleet_vehicle_required = True
        self.rpc(self.other_user).take_vehicle(self.bike.id)
        self.assertEqual(self._pick(), self.other)
        self.bike.sa_grounded = True
        self.assertFalse(self._pick())

    def test_offer_note_says_how_far(self):
        self._place(self.rider, NEAR)
        job = self._new_job(state='offered')
        job._sa_fleet_offer_note()
        self.assertIn('from the shop', job.message_ids[:1].body)

    def test_decline_passes_to_the_next_nearest(self):
        self._place(self.rider, NEAR)
        self._place(self.other, FAR)
        job = self._new_job(state='offered')
        self.rpc().decline(job.id)
        self.assertEqual(job.sa_delivery_partner_id, self.other)


@tagged('post_install', '-at_install')
class TestArrivalCheck(TripCase):
    """Tapping Arrived far from the shop is noted, or refused."""

    def test_warn_lets_it_through_and_notes_it(self):
        job = self._new_job(state='accepted')
        out = self.rpc().arrived(job.id, 'shop', latitude=FAR[0],
                                 longitude=FAR[1], accuracy=10)
        self.assertTrue(out['success'])
        self.assertGreater(job.sa_arrived_shop_distance_m, 1000)
        self.assertIn('tapped Arrived', job.message_ids[:1].body)

    def test_block_refuses_too_far(self):
        self.settings.fleet_arrive_enforce = 'block'
        job = self._new_job(state='accepted')
        out = self.rpc().arrived(job.id, 'shop', latitude=FAR[0], longitude=FAR[1])
        self.assertFalse(out['success'])
        self.assertEqual(out['code'], 'too_far')
        self.assertGreater(out['distance_m'], 1000)
        self.assertEqual(job.sa_delivery_state, 'accepted')

    def test_near_is_fine_in_block_mode(self):
        self.settings.fleet_arrive_enforce = 'block'
        job = self._new_job(state='accepted')
        out = self.rpc().arrived(job.id, 'shop', latitude=NEAR[0], longitude=NEAR[1])
        self.assertTrue(out['success'])
        self.assertLess(job.sa_arrived_shop_distance_m, 150)

    def test_accuracy_widens_the_radius(self):
        self.settings.write({'fleet_arrive_enforce': 'block',
                             'fleet_arrive_radius_m': 10})
        job = self._new_job(state='accepted')
        out = self.rpc().arrived(job.id, 'shop', latitude=NEAR[0],
                                 longitude=NEAR[1], accuracy=80)
        self.assertTrue(out['success'], "~33 m away, 10 m + 80 m of slack.")

    def test_no_position_never_blocks(self):
        self.settings.fleet_arrive_enforce = 'block'
        job = self._new_job(state='accepted')
        self.assertTrue(self.rpc().arrived(job.id, 'shop')['success'])

    def test_last_fix_is_used_when_the_phone_sends_none(self):
        self.settings.fleet_arrive_enforce = 'block'
        self._place(self.rider, FAR)
        job = self._new_job(state='accepted')
        self.assertEqual(self.rpc().arrived(job.id, 'shop')['code'], 'too_far')


@tagged('post_install', '-at_install')
class TestTrackFromAccept(TripCase):
    """The customer follows the rider from accept, when Settings say so."""

    def setUp(self):
        super().setUp()
        self.settings.fleet_track_from_accept = False

    def test_off_keeps_the_old_rule(self):
        job = self._new_job(state='accepted')
        self.assertFalse(job.sa_tracking_enabled())
        self.assertTrue(self.rpc().ping(job.id, *NEAR)['stop'])
        self.assertNotIn('track_from_accept', self.rpc().me()['fleet']['features'])

    def test_on_tracks_from_accept_to_the_door(self):
        self.settings.fleet_track_from_accept = True
        self.assertIn('track_from_accept', self.rpc().me()['fleet']['features'])
        job = self._new_job()
        rpc = self.rpc()
        accepted = rpc.accept(job.id)
        self.assertTrue(accepted['tracking']['enabled'],
                        "The app starts sending at accept.")
        out = rpc.ping(job.id, *NEAR)
        self.assertFalse(out['stop'])
        self.assertAlmostEqual(job.sa_rider_lat, NEAR[0], places=5)
        code = rpc.arrived(job.id, 'shop')['otp_debug']
        self.assertTrue(rpc.verify_pickup(job.id, code)['tracking']['enabled'])
        self.assertTrue(job.sa_tracking_enabled(), "Collected: still live.")

    def test_on_still_stops_when_delivered(self):
        self.settings.fleet_track_from_accept = True
        job = self._new_job()
        rpc = self.rpc()
        code = self._to_door(job, rpc)
        done = rpc.verify_delivery(job.id, code)
        self.assertFalse(done['tracking']['enabled'])
        self.assertTrue(rpc.ping(job.id, *NEAR)['stop'])


@tagged('post_install', '-at_install')
class TestFuelIssuesProof(TripCase):
    """Fuel and problems into Fleet's log; the photo at the door."""

    def setUp(self):
        super().setUp()
        self.settings.fleet_rider_logs = True

    def test_features_are_announced(self):
        fleet = self.rpc().me()['fleet']
        for feature in ('geofence', 'fuel', 'proof'):
            self.assertIn(feature, fleet['features'])
        self.assertIn('proof_required', fleet)

    def test_logs_switched_off_save_nothing(self):
        self.settings.fleet_rider_logs = False
        rpc = self.rpc()
        rpc.take_vehicle(self.bike.id)
        self.assertNotIn('fuel', rpc.me()['fleet']['features'],
                         "Off: the app hides My vehicle.")
        Log = self.env['fleet.vehicle.log.services']
        before = Log.search_count([('vehicle_id', '=', self.bike.id)])
        self.assertEqual(rpc.fuel_report(liters=5)['code'], 'disabled')
        self.assertEqual(rpc.vehicle_issue(category='other', grounded=True)['code'],
                         'disabled')
        self.assertEqual(Log.search_count([('vehicle_id', '=', self.bike.id)]), before)
        self.assertFalse(self.bike.sa_grounded)

    def test_fuel_needs_a_vehicle(self):
        out = self.rpc().fuel_report(liters=5)
        self.assertEqual(out['code'], 'no_vehicle')

    def test_fuel_goes_into_the_service_log(self):
        rpc = self.rpc()
        rpc.take_vehicle(self.bike.id)
        out = rpc.fuel_report(liters=12.5, amount=3.2, odometer=1500,
                              photo_base64=PNG, client_uuid='fuel-1')
        self.assertTrue(out['success'], out)
        log = self.env['fleet.vehicle.log.services'].browse(out['log_id'])
        self.assertEqual(log.service_type_id,
                         self.env.ref('delivery_fleet_ops.service_type_fuel'))
        self.assertEqual(log.amount, 3.2)
        self.assertEqual(self.bike.odometer, 1500)
        self.assertTrue(self.env['ir.attachment'].search_count(
            [('res_model', '=', log._name), ('res_id', '=', log.id)]))
        again = rpc.fuel_report(liters=12.5, amount=3.2, odometer=1500,
                                client_uuid='fuel-1')
        self.assertEqual(again['log_id'], log.id, "A replay logs nothing new.")

    def test_odometer_cannot_go_back(self):
        rpc = self.rpc()
        rpc.take_vehicle(self.bike.id)
        rpc.fuel_report(liters=5, odometer=2000)
        self.assertEqual(rpc.fuel_report(liters=5, odometer=1000)['code'],
                         'bad_odometer')

    def test_problem_can_ground_the_vehicle(self):
        rpc = self.rpc()
        rpc.take_vehicle(self.bike2.id)
        out = rpc.vehicle_issue(category='flat_tyre', note='rear tyre',
                                grounded=True)
        self.assertTrue(out['grounded'])
        self.assertTrue(self.bike2.sa_grounded)
        log = self.env['fleet.vehicle.log.services'].browse(out['log_id'])
        self.assertEqual(log.state, 'new')
        self.assertIn('Flat tyre', log.description)
        rpc.set_duty(False)
        ids = [v['id'] for v in self.rpc(self.other_user).vehicles()['vehicles']]
        self.assertNotIn(self.bike2.id, ids, "Grounded: offered to nobody.")

    def test_photo_is_kept_on_the_job(self):
        job = self._new_job(state='out_for_delivery')
        out = self.rpc().upload_proof(job.id, PNG)
        self.assertEqual(job.sa_proof_attachment_id.id, out['attachment_id'])

    def test_required_photo_blocks_the_code(self):
        self.settings.fleet_proof_required = True
        job = self._new_job()
        rpc = self.rpc()
        code = self._to_door(job, rpc)
        out = rpc.verify_delivery(job.id, code)
        self.assertEqual(out['code'], 'proof_needed')
        self.assertEqual(job.sa_delivery_state, 'out_for_delivery')
        rpc.upload_proof(job.id, PNG)
        self.assertEqual(rpc.verify_delivery(job.id, code)['status'], 'delivered')
