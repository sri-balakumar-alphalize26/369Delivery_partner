import json

from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestPartnerApi(HttpCase):
    """`/api/partner/me`, signed in with the delivery module's own token."""

    def setUp(self):
        super().setUp()
        self.rider = self.env['sa.delivery.partner'].sudo().create({
            'name': 'API Person', 'phone': '96890005556', 'kind': 'own',
            'work_type': 'both'})
        self.token, _refresh = self.env['sa.delivery.token']._issue(
            self.rider, 'test')

    def _me(self, token=None):
        headers = {'Authorization': 'Bearer %s' % token} if token else {}
        return self.url_open('/api/partner/me', headers=headers)

    def test_me(self):
        res = self._me(self.token)
        self.assertEqual(res.status_code, 200)
        body = json.loads(res.content)
        self.assertTrue(body['success'])
        self.assertEqual(body['rider_id'], self.rider.id)
        self.assertEqual(body['work_type'], 'both')
        self.assertEqual(body['busy_line'], 'none')
        self.assertFalse(body['service_available'])
        self.assertEqual(body['lines'], ['delivery'])

    def test_me_needs_a_token(self):
        res = self._me()
        self.assertEqual(res.status_code, 401)
        self.assertEqual(json.loads(res.content)['code'], 'unauthorized')

    def test_me_refuses_a_wrong_token(self):
        res = self._me('not-a-real-token')
        self.assertEqual(res.status_code, 401)
