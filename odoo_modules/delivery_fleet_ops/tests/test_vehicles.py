from odoo.tests import tagged

from odoo.addons.delivery_rider_rpc.tests.common import RiderRpcCase


@tagged('post_install', '-at_install')
class TestVehicles(RiderRpcCase):
    """Riders take a Fleet vehicle when they clock on, and give it back."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env = cls.env
        brand = env['fleet.vehicle.model.brand'].create({'name': 'Fleet Ops Moto'})
        model = env['fleet.vehicle.model'].create({
            'name': 'Courier 125', 'brand_id': brand.id, 'vehicle_type': 'bike'})
        Vehicle = env['fleet.vehicle'].sudo()
        cls.bike = Vehicle.create({'model_id': model.id, 'license_plate': 'FO 1',
                                   'sa_rider_ok': True})
        cls.bike2 = Vehicle.create({'model_id': model.id, 'license_plate': 'FO 2',
                                    'sa_rider_ok': True})
        cls.office_car = Vehicle.create({'model_id': model.id,
                                         'license_plate': 'FO 3'})
        cls.settings = env['sa.delivery.settings'].sudo().get_settings()

    def setUp(self):
        super().setUp()
        (self.rider | self.other).write({'on_duty': False})
        self.settings.fleet_vehicle_required = False

    def _ids(self, answer):
        return [v['id'] for v in answer['vehicles']]

    # ---------------------------------------------------------------- reads

    def test_me_carries_the_fleet_block(self):
        fleet = self.rpc().me()['fleet']
        self.assertIsNone(fleet['vehicle'])
        self.assertIn('vehicles', fleet['features'])
        self.assertFalse(fleet['vehicle_required'])

    def test_only_free_rider_vehicles_are_offered(self):
        self.bike2.sa_grounded = True
        ids = self._ids(self.rpc().vehicles())
        self.assertIn(self.bike.id, ids)
        self.assertNotIn(self.bike2.id, ids, "Grounded.")
        self.assertNotIn(self.office_car.id, ids, "Not a rider vehicle.")

        self.rpc(self.other_user).set_duty(True, vehicle_id=self.bike.id)
        self.assertNotIn(self.bike.id, self._ids(self.rpc().vehicles()),
                         "Out with another rider.")

    def test_usual_vehicle_is_preselected(self):
        self.rider.default_vehicle_id = self.bike2
        self.assertEqual(self.rpc().vehicles()['preselect_id'], self.bike2.id)

    # ----------------------------------------------------------------- duty

    def test_clock_on_with_a_vehicle(self):
        out = self.rpc().set_duty(True, vehicle_id=self.bike.id)
        self.assertTrue(out['success'])
        self.assertEqual(out['vehicle']['id'], self.bike.id)
        self.assertEqual(out['vehicle']['type'], 'bike')
        self.assertEqual(self.rider.vehicle_id, self.bike)
        self.assertEqual(self.bike.sa_rider_id, self.rider)
        self.assertEqual(self.bike.driver_id, self.rider_user.partner_id,
                         "Fleet's Driver is the rider.")
        self.assertEqual(self.rpc().me()['fleet']['vehicle']['id'],
                         self.bike.id)

    def test_a_vehicle_out_with_somebody_else_is_refused(self):
        self.rpc(self.other_user).set_duty(True, vehicle_id=self.bike.id)
        out = self.rpc().set_duty(True, vehicle_id=self.bike.id)
        self.assertFalse(out['success'])
        self.assertEqual(out['code'], 'vehicle_unavailable')
        self.assertFalse(self.rider.on_duty)
        self.assertEqual(self.bike.sa_rider_id, self.other)

    def test_required_vehicle_keeps_the_rider_off_duty(self):
        self.settings.fleet_vehicle_required = True
        out = self.rpc().set_duty(True)
        self.assertFalse(out['success'])
        self.assertEqual(out['code'], 'vehicle_needed')
        self.assertIn(self.bike.id, self._ids(out))
        self.assertFalse(self.rider.on_duty)

    def test_not_required_goes_on_without(self):
        out = self.rpc().set_duty(True)
        self.assertTrue(out['success'])
        self.assertIsNone(out['vehicle'])
        self.assertTrue(self.rider.on_duty)

    def test_usual_vehicle_is_taken_when_none_is_named(self):
        self.settings.fleet_vehicle_required = True
        self.rider.default_vehicle_id = self.bike2
        out = self.rpc().set_duty(True)
        self.assertTrue(out['success'])
        self.assertEqual(self.rider.vehicle_id, self.bike2)

    def test_clock_off_gives_it_back(self):
        self.rpc().set_duty(True, vehicle_id=self.bike.id)
        out = self.rpc().set_duty(False)
        self.assertTrue(out['success'])
        self.assertIsNone(out['vehicle'])
        self.assertFalse(self.bike.sa_rider_id)
        self.assertEqual(self.bike.driver_id, self.rider_user.partner_id,
                         "Fleet's Driver stays: who rode it last.")

    def test_office_switch_off_gives_it_back(self):
        self.rpc().set_duty(True, vehicle_id=self.bike.id)
        self.rider.write({'on_duty': False})     # the list's toggle
        self.assertFalse(self.rider.vehicle_id)
        self.assertFalse(self.bike.sa_rider_id)

    def test_swapping_vehicles_on_duty_keeps_the_shift(self):
        self.rpc().set_duty(True, vehicle_id=self.bike.id)
        since = self.rider.duty_since
        out = self.rpc().take_vehicle(self.bike2.id)
        self.assertTrue(out['success'])
        self.assertEqual(out['vehicle']['id'], self.bike2.id)
        self.assertEqual(self.rider.vehicle_id, self.bike2)
        self.assertFalse(self.bike.sa_rider_id)
        self.assertEqual(self.rider.duty_since, since,
                         "Changing bikes is not clocking on again.")

    def test_take_vehicle_needs_duty_and_a_free_vehicle(self):
        out = self.rpc().take_vehicle(self.bike.id)
        self.assertEqual(out['code'], 'off_duty')
        self.rpc(self.other_user).set_duty(True, vehicle_id=self.bike.id)
        self.rpc().set_duty(True)
        out = self.rpc().take_vehicle(self.bike.id)
        self.assertEqual(out['code'], 'vehicle_unavailable')
        self.assertEqual(self.bike.sa_rider_id, self.other)

    def test_handover_closes_history_without_a_todo(self):
        self.rpc().set_duty(True, vehicle_id=self.bike.id)
        self.rpc().set_duty(False)
        self.rpc(self.other_user).set_duty(True, vehicle_id=self.bike.id)

        logs = self.env['fleet.vehicle.assignation.log'].search(
            [('vehicle_id', '=', self.bike.id)], order='id')
        self.assertEqual(logs.mapped('driver_id'),
                         self.rider_user.partner_id | self.other_user.partner_id)
        self.assertTrue(logs[0].date_end, "The first rider's line is closed.")
        self.assertFalse(logs[1].date_end)
        self.assertFalse(self.bike.activity_ids,
                         "No 'Specify the End date' to-do for the office.")

    def test_replayed_clock_on_is_answered_once(self):
        first = self.rpc().set_duty(True, client_uuid='fo-1',
                                    vehicle_id=self.bike.id)
        again = self.rpc().set_duty(True, client_uuid='fo-1',
                                    vehicle_id=self.bike.id)
        self.assertTrue(again['success'])
        self.assertEqual(again['duty_since'], first['duty_since'])
        self.assertEqual(self.rider.vehicle_id, self.bike)
