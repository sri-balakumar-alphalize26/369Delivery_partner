"""Everything the rider app calls, through Odoo's own JSON-RPC.

    POST /web/session/authenticate   {db, login, password}
    POST /web/dataset/call_kw        {model: 'sa.rider.rpc', method, args, kwargs}

The rider is the `sa.delivery.partner` whose `user_id` is the logged-in user.
Nothing else is trusted: every job id is checked to belong to that rider, and
every read and write is done with sudo *after* that check, so a rider user
needs no access rights on pickings or the sa.* models at all.

The shapes are the ones the app already parses from `/api/delivery/*` (field
for field), so switching the app over is a transport change, not a rewrite.

Two kinds of "no":

* a business refusal - wrong state, wrong code, not your job - is a normal
  answer: `{'success': False, 'code': 'wrong_state', 'status': ..,
  'allowed_actions': [..]}`. The app redraws its buttons from it.
* not signed in, or signed in but not a rider, raises `AccessError`, which
  reaches the app as a JSON-RPC `error`. There is nothing to redraw.

Steps run the delivery module's own `sa_set_state()` under `rider_rpc_queue`,
which queues their WhatsApp messages in `sa.rider.outbox` instead of sending
them while the rider waits.
"""

import base64
import logging

from odoo import _, api, fields, models
from odoo.exceptions import AccessError

_logger = logging.getLogger(__name__)

# Nothing a rider can still act on; these belong in history().
_TERMINAL = ('delivered', 'returned', 'cancelled', 'failed')
_HELD = ('accepted', 'picked', 'dispatched', 'out_for_delivery')


def _dt(value):
    """UTC with a Z, as the REST API sends it - naive would read as local."""
    return (value.isoformat() + 'Z') if value else ''


def _money(amount, currency):
    places = currency.decimal_places if currency else 2
    return round(amount or 0.0, places)


def _currency_block(currency):
    return {
        'code': currency.name or '',
        'symbol': currency.symbol or '',
        'decimals': currency.decimal_places if currency else 2,
    }


class SaRiderRpc(models.AbstractModel):
    _name = 'sa.rider.rpc'
    _description = 'Rider App (JSON-RPC)'

    # ================================================================ plumbing

    @api.model
    def _rider(self):
        rider = self.env['sa.delivery.partner'].sudo().search(
            [('user_id', '=', self.env.uid), ('active', '=', True)], limit=1)
        if not rider:
            raise AccessError(_(
                "Signed in, but this user is not linked to a rider. Ask the "
                "office to press \"Create app login\" on the rider's record."))
        return rider

    @api.model
    def _job(self, rider, job_id):
        """The job, only if it is this rider's - else an empty recordset."""
        try:
            job_id = int(job_id or 0)
        except (TypeError, ValueError):
            job_id = 0
        job = self.env['stock.picking'].sudo().browse(job_id).exists()
        if not job or job.sa_delivery_partner_id != rider:
            return self.env['stock.picking']
        # Every step taken from here queues its WhatsApp messages.
        return job.with_context(rider_rpc_queue=True,
                                rider_rpc_picking_id=job.id)

    @api.model
    def _refuse(self, code, message, job=None, **extra):
        out = {'success': False, 'code': code, 'message': message}
        if job:
            out['status'] = job.sa_delivery_state
            out['allowed_actions'] = job.sa_allowed_actions()
        out.update(extra)
        return out

    @api.model
    def _not_found(self):
        return self._refuse('not_found', _("Not found."))

    @api.model
    def _once(self, rider, client_uuid, method, work):
        """Run `work()` once per `client_uuid`; replays get the first answer."""
        Log = self.env['sa.rider.rpc.log']
        client_uuid = (client_uuid or '').strip()[:64]
        if client_uuid:
            done = Log._replay(rider, client_uuid, method)
            if done is False:
                return self._refuse('uuid_reused', _(
                    "This action id was already used for a different action. "
                    "Send a new one."))
            if done is not None:
                return done
        result = work()
        if client_uuid and result.get('success'):
            Log._remember(rider, client_uuid, method, result)
        return result

    @api.model
    def _settings(self):
        return self.env['sa.delivery.settings'].sudo().get_settings()

    @api.model
    def _test_otp(self, out, code, job, kind):
        """The code in the answer - only with Delivery Settings' test switch."""
        if code and self._settings().otp_test_mode:
            out['otp_debug'] = code
            out['otp_debug_warning'] = (
                'TEST MODE: "Return OTPs in the API" is on in Delivery '
                'Settings. Turn it off before anyone real uses this.')
            _logger.warning("Rider RPC: OTP TEST MODE returned a %s code for "
                            "job %s", kind, job.sa_ref_code)
        return out

    # ============================================================ serialising

    @api.model
    def _rider_block(self, rider):
        return {'id': rider.id, 'name': rider.name, 'mobile': rider.phone,
                'kind': rider.kind, 'on_duty': rider.on_duty,
                'duty_since': _dt(rider.duty_since)}

    @api.model
    def _shop_block(self, shop):
        if not shop:
            return None
        contact = shop.partner_id
        base = self.env['stock.picking']._sa_public_base()
        image = ''
        if contact and contact.image_128:
            image = '%s/web/image/res.partner/%s/image_512' % (base, contact.id)
        return {
            'id': shop.id,
            'name': shop.name or '',
            'image_url': image or None,
            'latitude': contact.partner_latitude or None,
            'longitude': contact.partner_longitude or None,
            'address': ', '.join(filter(None, [contact.street, contact.city]))
                       if contact else '',
            'phone': shop.phone or (contact.phone if contact else '') or '',
        }

    @api.model
    def _brief(self, job):
        partner = job.partner_id
        moves = job.move_ids
        units = sum(moves.mapped('product_uom_qty'))
        due = job.sa_amount_due()
        return {
            'delivery_order_id': job.id,
            'delivery_order_name': job.name,
            'job_code': job.sa_ref_code or '',
            'sales_order': job.sale_id.name or '',
            'customer_name': partner.name or '',
            'customer_mobile': partner.phone or '',
            'delivery_address': ', '.join(filter(None, [
                partner.street, partner.street2, partner.city, partner.zip,
                partner.country_id.name])),
            'shop': self._shop_block(job.sa_shop_id),
            'items_summary': _("%(lines)s item(s) - %(units)s unit(s)",
                               lines=len(moves),
                               units=int(units) if float(units).is_integer()
                               else units),
            'products': [{'name': move.product_id.name,
                          'quantity': move.product_uom_qty,
                          'uom': move.product_uom.name or ''}
                         for move in moves],
            'payment_status': 'cod' if due else 'paid',
            'amount_to_collect': _money(due, job.sa_currency_id),
            'currency': _currency_block(job.sa_currency_id),
            'delivery_status': job.sa_delivery_state,
            'delivery_type': job.sa_delivery_kind or '',
            'promised_by': _dt(job.sa_promised_on),
            'allowed_actions': job.sa_allowed_actions(),
        }

    @api.model
    def _full(self, job):
        out = self._brief(job)
        partner = job.partner_id
        out.update({
            # null, never 0.0 - 0,0 is a real place in the Atlantic.
            'latitude': partner.partner_latitude or None,
            'longitude': partner.partner_longitude or None,
            'tracking': {'enabled': job.sa_tracking_enabled()},
            'timestamps': {
                'offered': _dt(job.sa_offered_on),
                'accepted': _dt(job.sa_accepted_on),
                'picked_up': _dt(job.sa_picked_on),
                'dispatched': _dt(job.sa_dispatched_on),
                'out_for_delivery': _dt(job.sa_out_on),
                'delivered': _dt(job.sa_delivered_on),
            },
            'delivered_at': _dt(job.sa_delivered_on),
        })
        return out

    @api.model
    def _step_answer(self, job, **extra):
        out = {'success': True, 'status': job.sa_delivery_state,
               'allowed_actions': job.sa_allowed_actions(),
               'tracking': {'enabled': job.sa_tracking_enabled()},
               'message': _("Done.")}
        out.update(extra)
        return out

    # ================================================================== reads

    @api.model
    def me(self):
        """Who the server thinks is calling. The app's first call."""
        rider = self._rider()
        return {
            'success': True,
            'rider': self._rider_block(rider),
            'timezone': rider.tz or 'UTC',
            'currency': _currency_block(self.env.company.currency_id),
            'server_time': _dt(fields.Datetime.now()),
        }

    @api.model
    def _jobs(self, rider, states=None):
        domain = [('sa_delivery_partner_id', '=', rider.id),
                  ('sa_delivery_state', 'not in', ('none', False))]
        if states:
            domain.append(('sa_delivery_state', 'in', list(states)))
        return self.env['stock.picking'].sudo().search(
            domain, order='sa_offered_on desc, id desc')

    @api.model
    def orders(self):
        """Open work, plus the four counters on the home screen."""
        rider = self._rider()
        jobs = self._jobs(rider)
        counts = {'assigned': 0, 'picked_up': 0, 'out_for_delivery': 0,
                  'delivered': 0}
        for job in jobs:
            state = job.sa_delivery_state
            if state in ('offered', 'accepted'):
                counts['assigned'] += 1
            elif state in ('picked', 'dispatched'):
                counts['picked_up'] += 1
            elif state == 'out_for_delivery':
                counts['out_for_delivery'] += 1
            elif state == 'delivered':
                counts['delivered'] += 1
        open_jobs = jobs.filtered(
            lambda p: p.sa_delivery_state not in _TERMINAL)
        return {
            'success': True,
            'counts': counts,
            'on_duty': rider.on_duty,
            'timezone': rider.tz or 'UTC',
            'server_time': _dt(fields.Datetime.now()),
            'orders': [self._brief(job) for job in open_jobs],
        }

    @api.model
    def order(self, job_id):
        """One job in full. Nested under `order` only - one shape."""
        job = self._job(self._rider(), job_id)
        if not job:
            return self._not_found()
        return {'success': True, 'order': self._full(job)}

    @api.model
    def history(self, limit=20, offset=0):
        rider = self._rider()
        try:
            limit, offset = int(limit or 20), int(offset or 0)
        except (TypeError, ValueError):
            limit, offset = 20, 0
        limit, offset = max(1, min(limit, 100)), max(0, offset)
        domain = [('sa_delivery_partner_id', '=', rider.id),
                  ('sa_delivery_state', 'in',
                   ('delivered', 'returned', 'cancelled'))]
        Picking = self.env['stock.picking'].sudo()
        rows = []
        for job in Picking.search(domain, order='id desc', limit=limit,
                                  offset=offset):
            finished = (job.sa_delivered_on or job.sa_returned_on
                        or job.sa_cancelled_on)
            delivered = job.sa_delivery_state == 'delivered'
            rows.append({
                'delivery_order_id': job.id,
                'job_code': job.sa_ref_code or '',
                'delivery_order_name': job.name,
                'sales_order': job.sale_id.name or '',
                'status': job.sa_delivery_state,
                'customer_name': job.partner_id.name or '',
                'city': job.partner_id.city or '',
                'shop': job.sa_shop_id.name or '',
                'finished_at': _dt(finished),
                'collected': _money(job.sa_cod_amount if delivered else 0.0,
                                    job.sa_currency_id),
                # No fee model yet; the field is here so adding one needs no
                # app release.
                'earnings': _money(0.0, job.sa_currency_id),
                'currency': _currency_block(job.sa_currency_id),
            })
        return {'success': True, 'total': Picking.search_count(domain),
                'limit': limit, 'offset': offset,
                'timezone': rider.tz or 'UTC', 'history': rows}

    # ================================================================== duty

    @api.model
    def set_duty(self, on_duty, client_uuid=None):
        """Clock on (which takes the jobs waiting for anyone) or off."""
        rider = self._rider()
        if isinstance(on_duty, str):
            on_duty = on_duty.strip().lower() in ('1', 'true', 'yes', 'on')

        def work():
            taken = rider.with_context(rider_rpc_queue=True).sa_set_duty(
                bool(on_duty))
            return {
                'success': True,
                'on_duty': rider.on_duty,
                'duty_since': _dt(rider.duty_since),
                'jobs_picked_up': taken or 0,
                'message': (_("You are on duty. %(n)s job(s) were waiting.",
                              n=taken or 0) if rider.on_duty
                            else _("You are off duty. Jobs already accepted "
                                   "are still yours.")),
            }
        return self._once(rider, client_uuid,
                          'set_duty:%s' % bool(on_duty), work)

    @api.model
    def rider_location(self, latitude=None, longitude=None, battery=None):
        """Where an idle rider is, so waiting work can go to the nearest."""
        rider = self._rider()
        if not rider.on_duty:
            return self._refuse('off_duty', _("You are no longer on duty."),
                                on_duty=False)
        vals = {'last_fix_on': fields.Datetime.now()}
        try:
            vals.update({'last_lat': float(latitude),
                         'last_lng': float(longitude)})
        except (TypeError, ValueError):
            pass
        try:
            vals['last_battery'] = float(battery)
        except (TypeError, ValueError):
            pass
        rider.write(vals)
        held = self._jobs(rider, _HELD)
        return {'success': True, 'on_duty': True,
                'poll_after_seconds': 30 if held else 120,
                'has_new_offer': bool(self._jobs(rider, ('offered',)))}

    # ================================================================= steps

    @api.model
    def _advance(self, job_id, action, client_uuid=None, otp_kind=None,
                 code=None, before=None):
        """Check the rider, the job and the state, then `sa_set_state()`."""
        rider = self._rider()

        def work():
            job = self._job(rider, job_id)
            if not job:
                return self._not_found()
            wanted_from, wanted_to = job._SA_ACTION_STATE[action]
            if job.sa_delivery_state not in wanted_from:
                return self._refuse(
                    'wrong_state',
                    _("This delivery is %(state)s - that is not possible now.",
                      state=job.sa_delivery_state), job)
            if otp_kind:
                ok, message = job.sa_verify_otp(otp_kind, code)
                if not ok:
                    return self._refuse('bad_otp', message, job)
            if before:
                before(job)
            job.sa_set_state(wanted_to)
            return self._step_answer(job)
        return self._once(rider, client_uuid, '%s:%s' % (action, job_id),
                          work)

    @api.model
    def accept(self, job_id, client_uuid=None):
        return self._advance(job_id, 'accept', client_uuid)

    @api.model
    def arrived(self, job_id, point='shop', client_uuid=None):
        """Reached the shop (sends the pickup code to the counter) or the
        customer (sends them the completion code, now rather than hours ago)."""
        rider = self._rider()
        point = (point or 'shop').strip().lower()

        def work():
            job = self._job(rider, job_id)
            if not job:
                return self._not_found()
            if point not in ('shop', 'customer'):
                return self._refuse('bad_point', _(
                    "Say whether you reached the shop or the customer."), job)
            allowed = ('accepted',) if point == 'shop' else ('out_for_delivery',)
            if job.sa_delivery_state not in allowed:
                return self._refuse(
                    'wrong_state',
                    _("This delivery is %(state)s - that is not possible now.",
                      state=job.sa_delivery_state), job)
            stamp = fields.Datetime.now()
            if point == 'shop':
                job.write({'sa_arrived_shop_on': stamp})
                ok, message, code = job.sa_issue_pickup_otp()
            else:
                job.write({'sa_arrived_customer_on': stamp})
                ok, message, code = job.sa_issue_delivery_otp()
            out = self._step_answer(job, message=message, otp_sent=bool(ok),
                                    arrived_at=_dt(stamp))
            return self._test_otp(out, code, job, 'pickup' if point == 'shop'
                                  else 'delivery')
        return self._once(rider, client_uuid,
                          'arrived:%s:%s' % (job_id, point), work)

    @api.model
    def request_pickup_otp(self, job_id):
        """Send (again) the pickup code to the shop's WhatsApp.

        `success` is True when a code was issued. The WhatsApp message itself
        is queued; `otp_sent` says whether the shop could be reached at all.
        """
        job = self._job(self._rider(), job_id)
        if not job:
            return self._not_found()
        if job.sa_delivery_state != 'accepted':
            return self._refuse('wrong_state', _("Not ready for pickup."), job)
        ok, message, code = job.sa_issue_pickup_otp()
        out = self._step_answer(job, success=bool(code), otp_sent=bool(ok),
                                message=message, retry_after_seconds=60)
        return self._test_otp(out, code, job, 'pickup')

    @api.model
    def verify_pickup(self, job_id, otp, client_uuid=None):
        return self._advance(job_id, 'pickup', client_uuid,
                             otp_kind='pickup', code=otp)

    @api.model
    def dispatch(self, job_id, client_uuid=None):
        return self._advance(job_id, 'dispatch', client_uuid)

    @api.model
    def start(self, job_id, client_uuid=None):
        """On the road. `sa_set_state` issues the customer's code here."""
        out = self._advance(job_id, 'start_delivery', client_uuid)
        if out.get('success') and not out.get('replayed'):
            job = self._job(self._rider(), job_id)
            self._test_otp(out, job.sa_last_delivery_code, job, 'delivery')
        return out

    @api.model
    def verify_delivery(self, job_id, otp, client_uuid=None):
        """The customer's code: the only way to `delivered`."""
        out = self._advance(job_id, 'complete', client_uuid,
                            otp_kind='delivery', code=otp)
        if out.get('success') and not out.get('replayed'):
            job = self._job(self._rider(), job_id)
            out.update({'allowed_actions': [], 'tracking': {'enabled': False},
                        'message': _("Delivery completed successfully"),
                        'delivered_at': _dt(job.sa_delivered_on)})
        return out

    @api.model
    def return_to_shop(self, job_id, reason='', client_uuid=None):
        """Refused at the door, nobody home. Only the shop closes it."""
        def note(job):
            job.sa_cancel_reason = (reason or '')[:250]
        return self._advance(job_id, 'return_to_shop', client_uuid,
                             before=note)

    @api.model
    def confirm_return(self, job_id, client_uuid=None):
        return self._advance(job_id, 'confirm_return', client_uuid)

    @api.model
    def report_issue(self, job_id, reason='', client_uuid=None):
        rider = self._rider()

        def work():
            job = self._job(rider, job_id)
            if not job:
                return self._not_found()
            text = (reason or '').strip()[:250]
            job.message_post(body=_("Rider %(rider)s reported: %(reason)s",
                                    rider=rider.name,
                                    reason=text or _("a problem")))
            job.sa_last_error = text
            return self._step_answer(
                job, message=_("Reported. Someone will follow up."))
        return self._once(rider, client_uuid, 'report_issue:%s' % job_id,
                          work)

    # ============================================================== position

    @api.model
    def ping(self, job_id, latitude, longitude, accuracy=None):
        """A position for the customer's tracking page.

        `stop: true` means tracking is over for this job and the app should
        switch its location service off.
        """
        job = self._job(self._rider(), job_id)
        if not job:
            return self._not_found()
        if not job.sa_tracking_enabled():
            return {'success': False, 'stop': True,
                    'status': job.sa_delivery_state,
                    'message': _("Tracking is not active for this delivery.")}
        self.env['sa.delivery.ping'].sudo()._sa_record(
            job, latitude, longitude, accuracy)
        return {'success': True, 'stop': False,
                'status': job.sa_delivery_state}

    @api.model
    def ping_batch(self, job_id, points):
        """Fixes buffered while offline, oldest first.

        [{latitude, longitude, accuracy}, ...] - capped at 200 so a phone that
        was offline all afternoon cannot send a day of GPS in one call.
        """
        job = self._job(self._rider(), job_id)
        if not job:
            return self._not_found()
        if not job.sa_tracking_enabled():
            return {'success': False, 'stop': True,
                    'status': job.sa_delivery_state, 'stored': 0}
        Ping = self.env['sa.delivery.ping'].sudo()
        stored = 0
        for point in (points or [])[-200:]:
            if isinstance(point, dict) and Ping._sa_record(
                    job, point.get('latitude'), point.get('longitude'),
                    point.get('accuracy')):
                stored += 1
        return {'success': True, 'stop': False,
                'status': job.sa_delivery_state, 'stored': stored}

    # ================================================================ proof

    @api.model
    def upload_proof(self, job_id, image_base64, filename=None):
        """A photo at the door, base64 - JSON-RPC carries no multipart."""
        job = self._job(self._rider(), job_id)
        if not job:
            return self._not_found()
        data = (image_base64 or '').split(',', 1)[-1].strip()
        try:
            raw = base64.b64decode(data, validate=True)
        except (ValueError, TypeError):
            raw = b''
        if not raw:
            return self._refuse('no_file', _("No photo received."), job)
        if len(raw) > 8 * 1024 * 1024:
            return self._refuse('too_large', _("The photo is over 8 MB."), job)
        attachment = self.env['ir.attachment'].sudo().create({
            'name': filename or 'proof-%s-%s.jpg' % (
                job.sa_ref_code, fields.Datetime.now()),
            'res_model': 'stock.picking',
            'res_id': job.id,
            'raw': raw,
        })
        return {'success': True, 'attachment_id': attachment.id,
                'message': _("Proof saved.")}

    # ================================================================= push

    @api.model
    def register_push(self, token, platform='android', **kwargs):
        """This phone should hear about new jobs. Re-registering is harmless;
        a token last used by another rider moves to this one.

        Anything else the app sends (it adds its EAS `project_id`) is
        accepted and ignored, so a new field never breaks registration."""
        rider = self._rider()
        token = (token or '').strip()
        if not token:
            return self._refuse('no_token', _("No push token."))
        if platform not in ('android', 'ios', 'web'):
            platform = 'android'
        Device = self.env['sa.rider.device'].sudo().with_context(
            active_test=False)
        device = Device.search([('token', '=', token)], limit=1)
        vals = {'rider_id': rider.id, 'platform': platform, 'active': True,
                'last_seen': fields.Datetime.now()}
        if device:
            device.write(vals)
        else:
            Device.create(dict(vals, token=token))
        return {'success': True}

    @api.model
    def unregister_push(self, token):
        rider = self._rider()
        self.env['sa.rider.device'].sudo().search(
            [('token', '=', (token or '').strip()),
             ('rider_id', '=', rider.id)]).write({'active': False})
        return {'success': True}
