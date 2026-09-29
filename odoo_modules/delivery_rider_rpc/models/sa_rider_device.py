"""A rider's phone, as Expo knows it."""

from odoo import fields, models


class SaRiderDevice(models.Model):
    _name = 'sa.rider.device'
    _description = 'Rider App Device'
    _order = 'last_seen desc, id desc'

    rider_id = fields.Many2one('sa.delivery.partner', required=True,
                               ondelete='cascade', index=True)
    token = fields.Char('Expo Push Token', required=True, index=True)
    platform = fields.Selection([('android', 'Android'), ('ios', 'iOS'),
                                 ('web', 'Web')], default='android')
    last_seen = fields.Datetime(default=fields.Datetime.now)
    active = fields.Boolean(default=True)

    # One phone, one rider: a handset passed to a colleague must stop
    # receiving the first rider's jobs.
    _uniq_token = models.Constraint('unique(token)',
                                    'This device is already registered.')
