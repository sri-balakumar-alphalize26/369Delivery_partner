"""What the rider app is told about vehicles, and how it takes one.

* `me` gains a `fleet` block. The app shows its vehicle screens only when the
  block is there, so it still works against a server without this module.
* `vehicles` lists what the rider may take now.
* `take_vehicle` swaps vehicles mid-shift without clocking on again.
* `rider_location`, `ping` and `ping_batch` also write the rider's position
  history (`sa.fleet.position`), which the office's live map draws. The
  `location` feature tells the app to send `rider_location` while on duty.
* `set_duty` takes an optional `vehicle_id`. Clocking on with none keeps the
  vehicle already in hand, else takes the rider's usual one if it is free.
  With **Vehicle Required** on and nothing to take, the rider stays off duty
  and is told `vehicle_needed`.
"""

from odoo import _, api, models


class SaRiderRpc(models.AbstractModel):
    _inherit = 'sa.rider.rpc'

    # ============================================================ serialising

    @api.model
    def _vehicle_block(self, vehicle):
        if not vehicle:
            return None
        return {
            'id': vehicle.id,
            'name': vehicle.name or '',
            'plate': vehicle.license_plate or '',
            'model': vehicle.model_id.name or '',
            'brand': vehicle.brand_id.name or '',
            'type': vehicle.vehicle_type or None,
            'grounded': vehicle.sa_grounded,
        }

    @api.model
    def _fleet_block(self, rider):
        return {
            'vehicle': self._vehicle_block(rider.vehicle_id),
            'default_vehicle_id': rider.default_vehicle_id.id or None,
            'vehicle_required': bool(self._settings().fleet_vehicle_required),
            'proof_required': bool(self._settings().fleet_proof_required),
            # Each one switches on an app screen or parameter; an app never
            # sends a server something its list does not name.
            'features': ['vehicles', 'location', 'geofence', 'proof']
            + (['fuel'] if self._settings().fleet_rider_logs else [])
            + (['track_from_accept']
               if self._settings().fleet_track_from_accept else []),
        }

    # ================================================================== reads

    @api.model
    def me(self):
        out = super().me()
        out['fleet'] = self._fleet_block(self._rider())
        return out

    @api.model
    def vehicles(self):
        """What this rider may take now, and which one the app should
        preselect."""
        rider = self._rider()
        free = rider._sa_fleet_vehicles()
        preselect = next((v for v in (rider.vehicle_id,
                                      rider.default_vehicle_id)
                          if v and v in free), free.browse())
        out = self._fleet_block(rider)
        out.update({
            'success': True,
            'vehicles': [self._vehicle_block(v) for v in free],
            'preselect_id': preselect.id or None,
        })
        return out

    # ================================================================== duty

    @api.model
    def _fleet_pick(self, rider, vehicle_id):
        """(vehicle, refusal) for clocking on. Both empty: go on without."""
        free = rider._sa_fleet_vehicles()
        choices = [self._vehicle_block(v) for v in free]
        if vehicle_id:
            try:
                vehicle_id = int(vehicle_id)
            except (TypeError, ValueError):
                vehicle_id = 0
            vehicle = free.filtered(lambda v: v.id == vehicle_id)
            if not vehicle:
                return None, self._refuse(
                    'vehicle_unavailable',
                    _("That vehicle is not free now. Pick another one."),
                    vehicles=choices, on_duty=rider.on_duty)
            return vehicle, None
        for vehicle in (rider.vehicle_id, rider.default_vehicle_id):
            if vehicle and vehicle in free:
                return vehicle, None
        if self._settings().fleet_vehicle_required:
            return None, self._refuse(
                'vehicle_needed',
                _("Pick the vehicle you are riding before going on duty.")
                if choices else
                _("No vehicle is free for you. Ask the office to give you "
                  "one before going on duty."),
                vehicles=choices, on_duty=rider.on_duty)
        return None, None

    @api.model
    def set_duty(self, on_duty, client_uuid=None, vehicle_id=None):
        """Clock on with a vehicle, or off (which gives it back)."""
        rider = self._rider()
        if isinstance(on_duty, str):
            on_duty = on_duty.strip().lower() in ('1', 'true', 'yes', 'on')
        on_duty = bool(on_duty)
        if on_duty:
            vehicle, refusal = self._fleet_pick(rider, vehicle_id)
            if refusal:
                return refusal
            if vehicle:
                rider._sa_fleet_take(vehicle)
        out = super().set_duty(on_duty, client_uuid=client_uuid)
        if out.get('success'):
            out['vehicle'] = self._vehicle_block(rider.vehicle_id)
        return out

    # ============================================================== position

    @api.model
    def rider_location(self, latitude=None, longitude=None, battery=None,
                       accuracy=None):
        """The on-duty heartbeat, now kept as history too."""
        out = super().rider_location(latitude=latitude, longitude=longitude,
                                     battery=battery)
        if out.get('success'):
            self.env['sa.fleet.position']._sa_record(
                self._rider(), latitude, longitude, accuracy=accuracy,
                battery=battery)
        return out

    @api.model
    def ping(self, job_id, latitude, longitude, accuracy=None):
        """A delivery's fix is also where the rider is."""
        out = super().ping(job_id, latitude, longitude, accuracy=accuracy)
        if out.get('success'):
            rider = self._rider()
            self.env['sa.fleet.position']._sa_record(
                rider, latitude, longitude, accuracy=accuracy,
                picking=self._job(rider, job_id))
        return out

    @api.model
    def ping_batch(self, job_id, points):
        """Only the newest of a buffered batch goes into history.

        The points carry no times of their own, so storing them all would
        stamp an afternoon of positions with this second and draw a trail
        the rider never rode.
        """
        out = super().ping_batch(job_id, points)
        newest = next((p for p in reversed(points or [])
                       if isinstance(p, dict)), None)
        if out.get('success') and newest:
            rider = self._rider()
            self.env['sa.fleet.position']._sa_record(
                rider, newest.get('latitude'), newest.get('longitude'),
                accuracy=newest.get('accuracy'),
                picking=self._job(rider, job_id))
        return out

    # ================================================================ vehicle

    @api.model
    def take_vehicle(self, vehicle_id, client_uuid=None):
        """Swap vehicles mid-shift.

        Not `set_duty` again: clocking on restarts `duty_since`, so a rider
        who changed bikes at lunch would lose the morning off their shift.
        """
        rider = self._rider()

        def work():
            if not rider.on_duty:
                return self._refuse('off_duty', _("You are no longer on duty."),
                                    on_duty=False)
            if not vehicle_id:
                return self._refuse('vehicle_needed',
                                    _("Say which vehicle you are taking."))
            vehicle, refusal = self._fleet_pick(rider, vehicle_id)
            if refusal:
                return refusal
            rider._sa_fleet_take(vehicle)
            return {'success': True,
                    'vehicle': self._vehicle_block(rider.vehicle_id),
                    'message': _("You are riding %s now.",
                                 vehicle.license_plate or vehicle.name)}
        return self._once(rider, client_uuid,
                          'take_vehicle:%s' % vehicle_id, work)
