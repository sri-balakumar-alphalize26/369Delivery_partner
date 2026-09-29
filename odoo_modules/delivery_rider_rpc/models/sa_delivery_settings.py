from odoo import fields, models


class SaDeliverySettings(models.Model):
    _inherit = 'sa.delivery.settings'

    rider_rpc_offer_timeout_min = fields.Integer(
        'Offer Timeout (minutes)', default=5,
        help="An offer nobody accepts within this many minutes is taken back "
             "and offered to the next rider on duty - or put back in To "
             "Dispatch when there is nobody. 0 turns this off.")
