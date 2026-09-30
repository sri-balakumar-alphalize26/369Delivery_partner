from odoo import fields, models


class SaDeliverySettings(models.Model):
    _inherit = 'sa.delivery.settings'

    fleet_vehicle_required = fields.Boolean(
        'Vehicle Required',
        help="A rider cannot clock on in the app without picking a vehicle. "
             "Off, the picker is still shown, but they may skip it.")
    fleet_fix_max_age_min = fields.Integer(
        'Position Goes Stale After (minutes)', default=10,
        help="A rider whose last position is older than this shows grey on "
             "the live map, and is not counted as near anything when a job "
             "is offered.")
    fleet_position_keep_days = fields.Integer(
        'Keep Position History (days)', default=7,
        help="Rider positions older than this are deleted every night. 0 "
             "keeps them all.")
    fleet_dispatch_max_km = fields.Float(
        'Offer Only Within (km)', default=0.0,
        help="A rider known to be farther than this from the shop is not "
             "offered its jobs. 0 means no limit. Riders with no recent "
             "position are still offered work - nobody knows they are far.")
    fleet_arrive_radius_m = fields.Integer(
        'Arrived Means Within (m)', default=150,
        help="How close to the shop or the customer a rider must be when "
             "they tap Arrived. The phone's own accuracy is added, up to "
             "100 m, so a weak fix is not held against them.")
    fleet_arrive_enforce = fields.Selection([
        ('warn', 'Note it on the delivery'),
        ('block', 'Refuse until they are there'),
    ], string='Arrived Too Far Away', default='warn', required=True)
    fleet_track_from_accept = fields.Boolean(
        'Customer Follows From Accept',
        help="The customer's tracking link shows the rider live from the "
             "moment they accept the job - riding to the shop, at the counter, "
             "and on to the door - as Fleetbase and the big food apps do. Off, "
             "the rider only appears once they tap Start delivery.")
    fleet_rider_logs = fields.Boolean(
        'Riders Log Fuel & Problems',
        help="Riders can log fuel and report vehicle problems from the app's "
             "My vehicle screen, into Fleet's service log. Off, the screen is "
             "hidden and nothing is saved.")
    fleet_proof_required = fields.Boolean(
        'Photo Required at Delivery',
        help="The rider must send a photo of the parcel at the door before "
             "the customer's code is accepted.")
