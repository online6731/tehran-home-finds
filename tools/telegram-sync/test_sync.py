"""No-network checks for duplicate prevention and edit reconciliation."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from sync import Sync, photo_ids, render, save


AD = {'id': 'fixture1', 'title': 'کمد آزمایشی', 'price': 2500000,
      'postedAt': 1792000800000, 'pics': ['https://s100.divarcdn.com/one.webp'],
      'category': 'کمد و جاکفشی', 'area': 'بهار', 'distanceKm': 1.2,
      'desc': '<متن فروشنده>', 'condition': 'کارکرده',
      'conditionAssessment': {'score': 60, 'reviewedPhotoCount': 0}}


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'topics.json').write_text(json.dumps({AD['category']: 5}))
        (self.root / 'emoji-catalog.json').write_text('{}')
        (self.root / 'test-token').write_text('local-fixture-value')
        self.sync = Sync(self.root, self.root / 'test-token')
        self.sync.bot_id = 123

    def tearDown(self):
        self.temp.cleanup()

    def existing(self):
        self.sync.state['items'][AD['id']] = {'message_id': 188, 'thread': 5,
            'ad': copy.deepcopy(AD), 'file_ids': ['cached-photo']}

    def test_relative_time_uses_original_absolute_timestamp(self):
        text = render(AD, 'active', {})
        self.assertIn('unix="1792000800" format="r"', text)
        self.assertIn('عکس بررسی‌نشده', text)
        self.assertIn('&lt;متن فروشنده&gt;', text)
        self.assertEqual(text.count('<img '), len(AD['pics']))

    def test_missing_timestamp_rejected(self):
        with self.assertRaises(ValueError):
            render({**AD, 'postedAt': None}, 'active', {})

    def test_uncertain_send_is_held_without_network_retry(self):
        self.sync.state['attempts'][AD['id']] = {'status': 'unknown'}
        with patch.object(self.sync, 'api') as api:
            with self.assertRaisesRegex(RuntimeError, 'ambiguous_new_send_held'):
                self.sync.apply(AD, 'active')
            api.assert_not_called()

    def test_edit_preserves_message_id_and_cached_photos(self):
        self.existing()
        receipt = {'ok': True, 'result': {'chat': {'id': -1003897574347},
            'from': {'id': 123}, 'message_id': 188,
            'rich_message': {'blocks': [{'type': 'photo', 'photo': [
                {'file_id': 'new-cache', 'width': 100, 'height': 100}]}]}}}
        with patch.object(self.sync, 'api', return_value=receipt) as api, patch('sync.time.sleep'):
            self.sync.apply(AD, 'active')
            method, data, files = api.call_args.args
            self.assertEqual(method, 'editMessageText')
            self.assertEqual(data['message_id'], 188)
            self.assertIsNone(files)
            self.assertIn('cached-photo', data['rich_message'])
            self.assertEqual(self.sync.state['items'][AD['id']]['file_ids'], ['new-cache'])
            api.reset_mock()
            self.sync.apply(AD, 'active')
            api.assert_not_called()

    def test_ambiguous_new_send_remains_held_after_reload(self):
        image = self.root / 'photo.jpg'
        image.write_bytes(b'fixture')
        with patch.object(self.sync, 'download', return_value=image), patch.object(self.sync, 'api', return_value={'ok': False, 'ambiguous': True, 'error_code': 'transport_unknown'}):
            with self.assertRaises(RuntimeError):
                self.sync.apply(AD, 'active')
        durable = json.loads(self.sync.state_path.read_text())
        self.assertEqual(durable['attempts'][AD['id']]['status'], 'unknown')
        self.assertNotIn(AD['id'], durable['items'])

    def test_not_modified_edit_is_reconciled(self):
        self.existing()
        with patch.object(self.sync, 'api', return_value={'ok': False, 'error_code': 400, 'description': 'Bad Request: message is not modified'}), patch('sync.time.sleep'):
            self.sync.apply(AD, 'active')
        self.assertTrue(self.sync.state['items'][AD['id']]['hash'])

    def test_photo_file_ids_preserve_gallery_order_and_largest_size(self):
        value = {'blocks': [{'type': 'slideshow', 'blocks': [
            {'type': 'photo', 'photo': [{'file_id': 'small', 'width': 1, 'height': 1}, {'file_id': 'large', 'width': 8, 'height': 8}]},
            {'type': 'photo', 'photo': [{'file_id': 'second', 'width': 8, 'height': 8}]}]}]}
        self.assertEqual(photo_ids(value), ['large', 'second'])

    def test_removed_does_not_claim_sold(self):
        self.assertIn('فروش‌رفتن تأیید نشده', render(AD, 'outside_catalog', {}))

    def test_gateway_failure_is_ambiguous(self):
        response = type('Response', (), {'json': lambda _: {'ok': False, 'error_code': 502}})()
        with patch.object(self.sync.http, 'post', return_value=response):
            self.assertTrue(self.sync.api('sendRichMessage', {})['ambiguous'])

    def test_legacy_gateway_failure_is_held(self):
        save(self.sync.state_path, {'items': {}, 'attempts': {'fixture1': {'status': 'failed', 'error_code': 502}}})
        reloaded = Sync(self.root, self.root / 'test-token')
        self.assertEqual(reloaded.state['attempts']['fixture1']['status'], 'unknown')


if __name__ == '__main__':
    unittest.main()
