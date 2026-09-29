"""Fixtures: two riders with app logins, a shop, and a job to carry.

The gateway is mocked at its lowest door, `_send_payload`, and not at
`send_message`: patching `send_message` on the registry class would shadow
this module's own override of it, and the queue is the thing under test.

Jobs are bare outgoing pickings with no sale order behind them. That keeps the
tests to this module's contract, and it is also what makes them independent of
whatever else is installed (the 369 Mart bridge only steps in for pickings
that carry a website order).
"""

from unittest.mock import patch

from odoo.tests import TransactionCase

from odoo.addons.whatsapp_gateway.models.whatsapp_session import (
    WhatsAppBlocked, WhatsAppQueued)


class RiderRpcCase(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env = cls.env

        # --------------------------------------------------- mocked gateway
        cls.wa_sent = []            # (number, text) that reached the gateway
        cls.gateway = {'mode': 'ok'}
        cls.expo_sent = []

        Session = env.registry['whatsapp.session']
        test = cls

        def send_payload(self, endpoint, payload, phone, log_text,
                         queue_on_failure=True, retry=None):
            mode = test.gateway['mode']
            if mode == 'queued':
                raise WhatsAppQueued('gateway down, kept as pending')
            if mode == 'blocked':
                raise WhatsAppBlocked('opted out')
            if mode == 'error':
                raise RuntimeError('socket closed')
            test.wa_sent.append((phone, payload.get('text')))
            return True

        def expo_post(self, messages):
            test.expo_sent.extend(messages)
            if test.gateway.get('expo') == 'unregistered':
                return {'data': [{'status': 'error', 'message': 'gone',
                                  'details': {'error': 'DeviceNotRegistered'}}]}
            return {'data': [{'status': 'ok', 'id': 'ticket'}]}

        patchers = [
            patch.object(Session, '_send_payload', send_payload),
            patch.object(Session, '_refresh_state',
                         lambda self, force=False: True),
            patch.object(Session, '_policy_block',
                         lambda self, phone, message: None),
            patch.object(env.registry['sa.rider.outbox'], '_expo_post',
                         expo_post),
            # The real guard commits on its own connection; a test must not.
            patch.object(env.registry['sa.outbox.guard'], 'claim',
                         lambda self, key, seconds=60: True),
            patch.object(env.registry['sa.outbox.guard'], 'release',
                         lambda self, key: True),
        ]
        for patcher in patchers:
            patcher.start()
            cls.addClassCleanup(patcher.stop)

        # Only ours may be found by `_sa_session()`'s "any active session".
        env['whatsapp.session'].sudo().search([]).write({'active': False})
        cls.session = env['whatsapp.session'].sudo().create({
            'name': 'Rider RPC Test Session',
            'gateway_api_key': 'rider-rpc-test-key',
        })
        cls.session.write({'status': 'connected', 'use_whatsapp': True})

        settings = env['sa.delivery.settings'].sudo().get_settings()
        settings.otp_test_mode = True
        if 'shop_confirms' in settings._fields:
            settings.shop_confirms = False

        cls.warehouse = env['stock.warehouse'].search(
            [('company_id', '=', env.company.id)], limit=1)
        cls.shop = env['sa.delivery.shop'].sudo().create({
            'name': 'RPC Test Counter',
            'phone': '96890001111',
            'warehouse_id': cls.warehouse.id,
        })
        cls.product = env['product.product'].create({
            'name': 'RPC Test Parcel',
            'type': 'consu',
            'is_storable': False,
            'list_price': 3.5,
        })
        cls.customer = env['res.partner'].create({
            'name': 'RPC Customer', 'phone': '+96890002222',
            'street': '1 Test Street', 'city': 'Muscat',
        })

        cls.rider, cls.rider_user = cls._rider('RPC Rider', '96890003333')
        cls.other, cls.other_user = cls._rider('Other Rider', '96890004444')

    @classmethod
    def _rider(cls, name, phone):
        rider = cls.env['sa.delivery.partner'].sudo().create({
            'name': name, 'phone': phone, 'kind': 'own',
        })
        rider.action_rider_rpc_create_login()
        return rider, rider.user_id

    def setUp(self):
        super().setUp()
        self.wa_sent.clear()
        self.expo_sent.clear()
        self.gateway.update(mode='ok', expo=None)

    # ------------------------------------------------------------- helpers

    def _new_job(self, rider=None, state='offered', cod=0.0):
        picking = self.env['stock.picking'].sudo().create({
            'picking_type_id': self.warehouse.out_type_id.id,
            'partner_id': self.customer.id,
            'location_id': self.warehouse.lot_stock_id.id,
            'location_dest_id': self.env.ref(
                'stock.stock_location_customers').id,
            'move_ids': [(0, 0, {
                'product_id': self.product.id,
                'product_uom_qty': 2,
                'product_uom': self.product.uom_id.id,
                'location_id': self.warehouse.lot_stock_id.id,
                'location_dest_id': self.env.ref(
                    'stock.stock_location_customers').id,
            })],
        })
        picking.action_confirm()
        picking._sa_ensure_identity()
        picking.write({
            'sa_shop_id': self.shop.id,
            'sa_delivery_partner_id': (rider or self.rider).id,
            'sa_cod_amount': cod,
            'sa_delivery_kind': 'quick',
        })
        picking.write({'sa_delivery_state': state})
        return picking

    def rpc(self, user=None):
        """`sa.rider.rpc` as the app sees it: that user, no superuser."""
        return self.env['sa.rider.rpc'].with_user(user or self.rider_user)

    def _outbox(self, job):
        return self.env['sa.rider.outbox'].sudo().search(
            [('picking_id', '=', job.id)], order='id')

    def _send(self):
        return self.env['sa.rider.outbox']._cron_send()
