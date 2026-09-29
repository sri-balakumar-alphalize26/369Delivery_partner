"""Answers already given, so an action replayed from the app runs once.

A rider taps "Picked up" in a basement, the app queues it with a fresh
`client_uuid`, and sends it again - maybe three times - once there is signal.
The first call that lands does the work and its answer is stored here; the
others get that same answer back with `replayed: true`.

Only successful answers are stored. A refused one (`bad_otp`, `wrong_state`)
changed nothing, and storing it would mean a rider who then types the right
code under the same uuid is told "wrong code" for ever.
"""

import json
from datetime import timedelta

from odoo import api, fields, models


class SaRiderRpcLog(models.Model):
    _name = 'sa.rider.rpc.log'
    _description = 'Rider App Replay Guard'
    _order = 'id desc'

    rider_id = fields.Many2one('sa.delivery.partner', required=True,
                               ondelete='cascade', index=True)
    client_uuid = fields.Char(required=True)
    method = fields.Char(required=True)
    result = fields.Text(required=True)

    _uniq_rider_uuid = models.Constraint(
        'unique(rider_id, client_uuid)',
        'This action was already received.')

    @api.model
    def _replay(self, rider, client_uuid, method):
        """The stored answer, `False` if this uuid was used for something
        else, or None when it is new.

        `method` carries the job too ("accept:42"). An app that reused a uuid
        for another job must not be told that job was accepted when nothing
        touched it.
        """
        row = self.sudo().search([('rider_id', '=', rider.id),
                                  ('client_uuid', '=', client_uuid)], limit=1)
        if not row:
            return None
        if row.method != method:
            return False
        out = json.loads(row.result)
        out['replayed'] = True
        return out

    @api.model
    def _remember(self, rider, client_uuid, method, result):
        self.sudo().create({'rider_id': rider.id, 'client_uuid': client_uuid,
                            'method': method,
                            'result': json.dumps(result, default=str)})

    @api.autovacuum
    def _gc_old(self):
        # An app offline for a week has bigger problems than a replay.
        limit = fields.Datetime.now() - timedelta(days=7)
        self.sudo().search([('create_date', '<', limit)]).unlink()
