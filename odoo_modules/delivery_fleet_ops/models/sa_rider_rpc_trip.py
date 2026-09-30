"""The trip itself: pins, "arrived", the doorstep, fuel, problems, the photo.

* `_shop_block` fills the shop's pickup pin from the warehouse when the shop
  contact has none, so the rider's map can draw the road to it.
* `arrived` takes the phone's position and checks it against the shop or the
  customer (Delivery Settings: note it, or refuse with `too_far`).
* `verify_delivery` refuses `proof_needed` while a required photo is missing,
  and on success keeps where the rider stood as the customer's pin.
* `upload_proof` remembers the photo on the job.
* `fuel_report` and `vehicle_issue` go into Fleet's own service log.
"""

import base64
import binascii
from datetime import timedelta

from odoo import _, api, fields, models

from .geo import metres_between, say_distance

_MAX_PHOTO = 8 * 1024 * 1024
_FRESH = timedelta(minutes=5)
_ISSUES = {
    'flat_tyre': 'Flat tyre',
    'breakdown': 'Breakdown',
    'accident': 'Accident',
    'other': 'Other',
}


def _float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class SaRiderRpc(models.AbstractModel):
    _inherit = 'sa.rider.rpc'

    # ================================================================== pins

    @api.model
    def _shop_block(self, shop):
        out = super()._shop_block(shop)
        if out and out.get('latitude') is None:
            point = shop._sa_fleet_point()
            if point:
                out['latitude'] = point['lat']
                out['longitude'] = point['lng']
        return out

    @api.model
    def _fleet_here(self, rider, latitude, longitude):
        """The phone's position if it sent one, else a fix under 5 min old."""
        lat, lng = _float(latitude), _float(longitude)
        if lat is not None and lng is not None and (lat or lng):
            return lat, lng
        if rider.last_fix_on and (rider.last_lat or rider.last_lng) and (
                fields.Datetime.now() - rider.last_fix_on <= _FRESH):
            return rider.last_lat, rider.last_lng
        return None

    # ============================================================== arrived

    @api.model
    def arrived(self, job_id, point='shop', client_uuid=None, latitude=None,
                longitude=None, accuracy=None):
        rider = self._rider()
        job = self._job(rider, job_id)
        where = (point or 'shop').strip().lower()
        wanted = {'shop': 'accepted', 'customer': 'out_for_delivery'}
        metres = limit = None
        if job and wanted.get(where) == job.sa_delivery_state:
            if where == 'shop':
                target = job.sa_shop_id._sa_fleet_point() if job.sa_shop_id \
                    else None
            else:
                partner = job.partner_id
                target = ({'lat': partner.partner_latitude,
                           'lng': partner.partner_longitude}
                          if partner and partner._sa_has_pin() else None)
            here = self._fleet_here(rider, latitude, longitude)
            if target and here:
                metres = metres_between(here[0], here[1], target['lat'],
                                        target['lng'])
                settings = self._settings()
                slack = min(max(_float(accuracy) or 0.0, 0.0), 100.0)
                limit = (settings.fleet_arrive_radius_m or 150) + slack
                if (metres is not None and metres > limit
                        and settings.fleet_arrive_enforce == 'block'):
                    return self._refuse('too_far', _(
                        "You are %(far)s from the %(place)s. Tap Arrived when "
                        "you are there.", far=say_distance(metres),
                        place=_('shop') if where == 'shop' else _('customer')),
                        job, distance_m=round(metres))

        out = super().arrived(job_id, point=point, client_uuid=client_uuid)

        if out.get('success') and job and metres is not None:
            field = ('sa_arrived_shop_distance_m' if where == 'shop'
                     else 'sa_arrived_customer_distance_m')
            first = not job[field]
            job.sudo().write({field: round(metres)})
            if first and metres > limit:
                job.message_post(body=_(
                    "%(rider)s tapped Arrived %(far)s from the %(place)s.",
                    rider=rider.name, far=say_distance(metres),
                    place=_('shop') if where == 'shop' else _('customer')))
        return out

    # ================================================================ proof

    @api.model
    def upload_proof(self, job_id, image_base64, filename=None):
        out = super().upload_proof(job_id, image_base64, filename=filename)
        if out.get('success') and out.get('attachment_id'):
            job = self._job(self._rider(), job_id)
            if job:
                job.sudo().sa_proof_attachment_id = out['attachment_id']
        return out

    @api.model
    def verify_delivery(self, job_id, otp, client_uuid=None):
        rider = self._rider()
        job = self._job(rider, job_id)
        if (job and self._settings().fleet_proof_required
                and job.sa_delivery_state == 'out_for_delivery'
                and not job.sa_proof_attachment_id):
            return self._refuse('proof_needed', _(
                "Take a photo of the parcel at the door first."), job)
        out = super().verify_delivery(job_id, otp, client_uuid=client_uuid)
        if out.get('success') and job:
            self._fleet_learn_door(rider, job)
        return out

    @api.model
    def _fleet_learn_door(self, rider, job):
        """The rider is at the door: that is where this customer lives."""
        partner = job.partner_id
        if not partner or partner.sa_geo_source in ('manual', 'doorstep'):
            return
        here = self._fleet_here(rider, None, None)
        if here:
            partner.sudo()._sa_set_pin(here[0], here[1], 'doorstep')

    # ======================================================= fuel, problems

    @api.model
    def _fleet_logs_off(self):
        """The refusal when Delivery Settings have fuel and problem logs off,
        else None. Nothing is saved while they are off."""
        if self._settings().fleet_rider_logs:
            return None
        return self._refuse('disabled', _(
            "Fuel and problem reports are switched off. Tell the office "
            "directly."))

    @api.model
    def _fleet_photo(self, image_base64):
        """(bytes or None, refusal or None) from a base64 photo, 8 MB max."""
        if not image_base64:
            return None, None
        data = str(image_base64).split(',', 1)[-1].strip()
        try:
            raw = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError, TypeError):
            raw = b''
        if not raw:
            return None, self._refuse('no_file', _("The photo did not arrive."))
        if len(raw) > _MAX_PHOTO:
            return None, self._refuse('too_large', _("The photo is over 8 MB."))
        return raw, None

    @api.model
    def _fleet_attach(self, record, raw, name):
        if raw:
            self.env['ir.attachment'].sudo().create({
                'name': name, 'raw': raw,
                'res_model': record._name, 'res_id': record.id,
            })

    @api.model
    def fuel_report(self, liters=None, amount=None, odometer=None, note='',
                    photo_base64=None, client_uuid=None):
        rider = self._rider()

        def work():
            off = self._fleet_logs_off()
            if off:
                return off
            vehicle = rider.vehicle_id.sudo()
            if not vehicle:
                return self._refuse('no_vehicle', _(
                    "Take a vehicle first - fuel is logged against the bike "
                    "you are riding."))
            litres = _float(liters)
            if not litres or litres <= 0:
                return self._refuse('bad_input', _("Say how many litres."))
            reading = _float(odometer)
            # `odometer` is computed with no dependencies, so a value read
            # earlier in this transaction would hide a reading taken since.
            vehicle.invalidate_recordset(['odometer'])
            if reading and reading < vehicle.odometer:
                return self._refuse('bad_odometer', _(
                    "The odometer reads less than last time (%s). Check the "
                    "number.", int(vehicle.odometer)))
            raw, refusal = self._fleet_photo(photo_base64)
            if refusal:
                return refusal
            vals = {
                'vehicle_id': vehicle.id,
                'service_type_id': self.env.ref(
                    'delivery_fleet_ops.service_type_fuel').id,
                'amount': max(_float(amount) or 0.0, 0.0),
                'description': _("%s L of fuel", ('%g' % litres)),
                'notes': (note or '').strip()[:500],
                'purchaser_id': rider._sa_fleet_partner().id or False,
                'state': 'done',
            }
            if reading:
                vals['odometer_id'] = self.env['fleet.vehicle.odometer'].sudo() \
                    .create({'vehicle_id': vehicle.id, 'value': reading,
                             'driver_id': vals['purchaser_id']}).id
            log = self.env['fleet.vehicle.log.services'].sudo().create(vals)
            vehicle.invalidate_recordset(['odometer'])
            self._fleet_attach(log, raw, 'fuel-receipt-%s.jpg' % log.id)
            return {'success': True, 'log_id': log.id,
                    'message': _("Fuel logged: %s L.", '%g' % litres)}
        return self._once(rider, client_uuid, 'fuel_report', work)

    @api.model
    def vehicle_issue(self, category='other', note='', photo_base64=None,
                      grounded=False, client_uuid=None):
        rider = self._rider()
        if isinstance(grounded, str):
            grounded = grounded.strip().lower() in ('1', 'true', 'yes', 'on')

        def work():
            off = self._fleet_logs_off()
            if off:
                return off
            vehicle = rider.vehicle_id.sudo()
            if not vehicle:
                return self._refuse('no_vehicle', _(
                    "Take a vehicle first - problems are logged against the "
                    "bike you are riding."))
            label = _ISSUES.get((category or 'other').strip().lower(),
                                _ISSUES['other'])
            text = (note or '').strip()[:500]
            raw, refusal = self._fleet_photo(photo_base64)
            if refusal:
                return refusal
            log = self.env['fleet.vehicle.log.services'].sudo().create({
                'vehicle_id': vehicle.id,
                'service_type_id': self.env.ref(
                    'delivery_fleet_ops.service_type_rider_issue').id,
                'description': ('%s: %s' % (label, text) if text else label)[:250],
                'notes': text,
                'purchaser_id': rider._sa_fleet_partner().id or False,
                'state': 'new',
            })
            self._fleet_attach(log, raw, 'vehicle-problem-%s.jpg' % log.id)
            if grounded:
                vehicle.sa_grounded = True
                vehicle.message_post(body=_(
                    "Grounded by %(rider)s: %(what)s", rider=rider.name,
                    what=log.description))
            return {'success': True, 'log_id': log.id, 'grounded': bool(grounded),
                    'message': (_("Reported. The vehicle is marked as not "
                                  "rideable; the office will follow up.")
                                if grounded else
                                _("Reported. The office will follow up."))}
        return self._once(rider, client_uuid, 'vehicle_issue', work)
