"""What the rider app is told about a job that came from the counter.

Two keys on every job, in the list and the detail alike:

* `packed_at` - when the shop pressed Packed, UTC with a Z; null before.
  The offer screen shows it, so a rider knows the parcel is waiting.
* `assigned_by` - `office` when a person chose the rider, `auto` when the
  least-busy rule did.
"""

from odoo import api, models

from odoo.addons.delivery_rider_rpc.models.sa_rider_rpc import _dt


class SaRiderRpc(models.AbstractModel):
    _inherit = 'sa.rider.rpc'

    @api.model
    def _brief(self, job):
        out = super()._brief(job)
        out.update({
            'packed_at': _dt(job.sa_shop_ready_on) or None,
            'assigned_by': 'office' if job.rider_rpc_hand_picked else 'auto',
        })
        return out
