"""Where a customer is: the drop pin of the rider's map (Fleetbase's "Places").

Nobody had pinned a customer, so every job map showed the rider's dot and
nothing to ride to. A pin now comes from one of three places, remembered in
`sa_geo_source` so a better one is never replaced by a worse one:

* **geocoded** - looked up from the written address when the job is offered.
  An estimate; the street has to be found, never just the city, or the rider
  would be sent to the town centre.
* **doorstep** - where the rider stood when the customer gave the delivery
  code. Exact, so an address lookup never overwrites it.
* **manual** - typed in by the office. Nothing automatic touches it.

Changing the address clears the pin (base_geolocalize already does that) and
its source with it.
"""

import logging

from odoo import fields, models

_logger = logging.getLogger(__name__)

_ADDRESS = ('street', 'zip', 'city', 'state_id', 'country_id')


class ResPartner(models.Model):
    _inherit = 'res.partner'

    sa_geo_source = fields.Selection([
        ('geocoded', 'From the address'),
        ('doorstep', 'Where the rider delivered'),
        ('manual', 'Set by hand'),
    ], string='Map Pin From', copy=False, readonly=True)

    def write(self, vals):
        if 'sa_geo_source' not in vals:
            if 'partner_latitude' in vals or 'partner_longitude' in vals:
                pinned = vals.get('partner_latitude') or vals.get('partner_longitude')
                vals['sa_geo_source'] = (
                    (self.env.context.get('sa_geo_source') or 'manual')
                    if pinned else False)
            elif any(f in vals for f in _ADDRESS):
                # base_geolocalize zeroes the pin in this same write.
                vals['sa_geo_source'] = False
        return super().write(vals)

    def _sa_has_pin(self):
        self.ensure_one()
        return bool(self.partner_latitude or self.partner_longitude)

    def _sa_set_pin(self, lat, lng, source):
        self.ensure_one()
        self.sudo().with_context(sa_geo_source=source).write({
            'partner_latitude': lat,
            'partner_longitude': lng,
            'date_localization': fields.Date.context_today(self),
        })

    def _sa_geocode(self):
        """Look the street address up; True when a pin was set.

        Not `geo_localize()`: that falls back to the city alone when the
        street is not found, which would pin every unknown address to the town
        centre, and it pops a notification at whoever happens to be the user.
        """
        self.ensure_one()
        if not (self.street and (self.city or self.zip)):
            return False
        partner = self.with_context(lang='en_US')
        geocoder = self.env['base.geocoder']
        query = geocoder.geo_query_address(
            street=partner.street, zip=partner.zip, city=partner.city,
            state=partner.state_id.name, country=partner.country_id.name)
        try:
            result = geocoder.geo_find(query,
                                       force_country=partner.country_id.name)
        except Exception:  # noqa: BLE001 - offline or refused: try later
            _logger.info("Fleet: could not geocode %s", self.display_name,
                         exc_info=True)
            return False
        if not result:
            return False
        self._sa_set_pin(result[0], result[1], 'geocoded')
        return True
