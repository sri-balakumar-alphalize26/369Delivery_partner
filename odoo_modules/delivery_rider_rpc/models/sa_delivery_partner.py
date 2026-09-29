from odoo import _, fields, models
from odoo.exceptions import UserError


class SaDeliveryPartner(models.Model):
    _inherit = 'sa.delivery.partner'

    rider_rpc_device_ids = fields.One2many(
        'sa.rider.device', 'rider_id', string='App Devices')

    def action_rider_rpc_create_login(self):
        """Give this rider an app login: a portal user, login = their number.

        Portal, not internal: the app needs `call_kw` and nothing else, and a
        portal user cannot open the backend even with the password in hand.
        An existing portal user with that login is linked rather than
        duplicated; an office user, or another rider's login, is refused.
        Ends on Odoo's own Change Password dialog, so the password is typed
        once by whoever hands the phone over and never stored anywhere else.
        """
        self.ensure_one()
        if self.user_id:
            user = self.user_id
        else:
            login = self._sa_digits(self.phone)
            if not login:
                raise UserError(_("Set the rider's WhatsApp number first - it "
                                  "becomes their app login."))
            Users = self.env['res.users'].sudo().with_context(
                active_test=False)
            user = Users.search([('login', '=', login)], limit=1)
            # Linking an office user would hand the rider a backend login, and
            # this button ends on Change Password - the office would reset a
            # colleague's password without knowing it.
            if user and not user.share:
                raise UserError(_(
                    "The login %(login)s already belongs to an office user "
                    "(%(user)s). Give the rider a different WhatsApp number, "
                    "or change that user's login first.",
                    login=login, user=user.name))
            if user and self.search([('user_id', '=', user.id),
                                     ('id', '!=', self.id)], limit=1):
                raise UserError(_(
                    "The login %s is already another rider's app login.",
                    login))
            if not user:
                vals = {
                    'name': self.name,
                    'login': login,
                    'group_ids': [(6, 0, [
                        self.env.ref('base.group_portal').id,
                        self.env.ref('delivery_rider_rpc.group_rider_app').id,
                    ])],
                }
                if self.partner_id and not self.partner_id.user_ids:
                    vals['partner_id'] = self.partner_id.id
                user = Users.with_context(no_reset_password=True).create(vals)
            self.user_id = user
        if not user.active:
            user.sudo().active = True
        rider_group = self.env.ref('delivery_rider_rpc.group_rider_app')
        if rider_group not in user.group_ids:
            user.sudo().group_ids = [(4, rider_group.id)]
        return {
            'type': 'ir.actions.act_window',
            'name': _('Set the app password for %s', self.name),
            'res_model': 'change.password.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {'active_model': 'res.users', 'active_ids': user.ids},
        }
