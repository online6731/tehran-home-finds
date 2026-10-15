"""Synchronize public catalog cards in the owner's existing Telegram forum.

No credentials or private delivery state belong in this repository. New sends
are journaled before the request and never blindly retried after ambiguity.
Edits are idempotent. A file lock prevents timer/manual overlap.
"""
import argparse
import contextlib
import fcntl
import hashlib
import html
import io
import json
import os
from pathlib import Path
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests
from PIL import Image, ImageOps

SOURCE = 'https://online6731.github.io/tehran-home-finds/api/listings.json'
CHAT = -1003897574347
BOT = 'AIR_AIRA_bot'
GROUP = 'آگهی‌های وسایل خانه تهران'
VERSION = 2


def save(path, value):
    tmp = path.with_suffix('.tmp')
    with tmp.open('w', encoding='utf-8') as handle:
        handle.write(json.dumps(value, ensure_ascii=False, indent=2))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)
    if os.name != 'nt':
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def fa(value):
    return str(value).translate(str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹'))


def esc(value):
    return html.escape(str(value), quote=True)


def stamp(ad):
    value = ad.get('postedAt')
    if not isinstance(value, (int, float)) or value <= 0:
        raise ValueError('absolute_publication_time_missing:' + ad['id'])
    return int(value / 1000)


def render(ad, status, emojis):
    def emoji(char):
        return ('<tg-emoji emoji-id="' + emojis[char] + '">' + char + '</tg-emoji>') if char in emojis else char
    posted = stamp(ad)
    date = datetime.fromtimestamp(posted, ZoneInfo('Asia/Tehran')).strftime('%Y/%m/%d %H:%M')
    age = '<tg-time unix="' + str(posted) + '" format="r">' + fa(date) + '</tg-time>'
    assessment = ad.get('conditionAssessment') or {}
    score = assessment.get('score')
    score_text = fa(score) + '/۱۰۰' if score is not None else 'بررسی‌نشده'
    reviewed = assessment.get('reviewedPhotoCount', 0)
    basis = 'از عکس و توضیحات' if reviewed else 'فقط توضیحات؛ عکس بررسی‌نشده'
    distance = fa(ad.get('distanceKm')) + ' کیلومتر' if isinstance(ad.get('distanceKm'), (int, float)) else 'نیازمند تعیین موقعیت'
    price = fa(format(ad['price'], ',')) + ' تومان'
    blocks = ['<p><b>' + emoji('⭐') + ' ' + esc(ad['title']) + '</b><br><b>' + emoji('💰') + ' ' + price + '</b> · ' + esc(ad.get('condition', '')) + '</p>']
    if status != 'active':
        label = 'پایان بازهٔ ۲۴ ساعت' if status == 'expired' else 'خارج از فهرست فعلی؛ فروش‌رفتن تأیید نشده'
        blocks.append('<p><b>' + emoji('⚠️') + ' ' + label + '</b></p>')
    blocks.append('<p>' + emoji('📍') + ' ' + esc(ad.get('area', 'تهران')) + ' · تا هفت‌تیر ≈ ' + distance + '<br>' + emoji('🕒') + ' ثبت دیوار: ' + age + '<br>' + emoji('🔎') + ' وضعیت تخمینی <b>' + score_text + '</b> · ' + basis + '</p>')
    images = ''.join('<img src="tg://photo?id=p' + str(n) + '"/>' for n in range(1, len(ad['pics']) + 1))
    blocks.append('<tg-slideshow>' + images + '</tg-slideshow>')
    details = ['<p>انتشار مطلق دیوار: ' + fa(date) + ' (تهران)' + ('؛ تقریبی' if ad.get('postedAtIsApproximate') else '') + '<br>مبنای فاصله: ' + esc(ad.get('distanceReference', 'نقشهٔ آگهی')) + '</p>']
    if ad.get('distanceSource'):
        details.append('<p><a href="' + esc(ad['distanceSource']) + '">مرجع موقعیت</a></p>')
    details.append('<p>شاخص فاصله با نو: ' + fa(assessment.get('distanceFromNew', 'ثبت نشده')) + ' از ۱۰۰ · اطمینان: ' + esc(assessment.get('confidence', 'نامشخص')) + ' · عکس بررسی‌شده: ' + fa(reviewed) + '/' + fa(len(ad['pics'])) + '</p>')
    quality = ad.get('quality') or {}
    for key, label in [('observations', 'مشاهدات عکس'), ('sellerClaims', 'ادعای فروشنده'), ('cautions', 'محدودیت‌ها')]:
        values = quality.get(key)
        if values:
            details.append('<p><b>' + label + '</b><br>' + esc('\n'.join(values) if isinstance(values, list) else values).replace('\n', '<br>') + '</p>')
    reasons = assessment.get('reasons', []) + assessment.get('limitations', [])
    if reasons:
        details.append('<p>' + esc('\n'.join(reasons)).replace('\n', '<br>') + '</p>')
    details.append('<p><b>توضیحات فروشنده</b><br>' + esc(ad.get('desc', '')).replace('\n', '<br>') + '</p>')
    details.append('<p>امتیاز تخمینی است؛ شاخص فاصله با نو درصد واقعی استهلاک نیست. ادعای فروشنده و عکس، سلامت فنی را تأیید نمی‌کنند. قیمت و موجودی نیازمند تماس است.</p>')
    blocks.append('<details><summary>' + emoji('📝') + ' توضیحات و ارزیابی کامل</summary>' + ''.join(details) + '</details>')
    blocks.append('<p><a href="https://divar.ir/v/_/' + esc(ad['id']) + '">دیوار ↗</a> · <a href="https://online6731.github.io/tehran-home-finds/">فهرست سایت</a> · ' + esc(ad['id']) + '</p>')
    return ''.join(blocks)


def photo_ids(value):
    """Preserve slideshow traversal order and use the largest Telegram size."""
    result = []
    def walk(node):
        if isinstance(node, dict):
            if node.get('type') == 'photo' and isinstance(node.get('photo'), list):
                sizes = node['photo']
                if sizes:
                    result.append(max(sizes, key=lambda p: p.get('width', 0) * p.get('height', 0))['file_id'])
                return
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)
    walk(value)
    return result


class Sync:
    def __init__(self, root, token_path):
        self.root = root
        self.state_path = root / 'state.json'
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {'items': {}, 'attempts': {}}
        self.topics = json.loads((root / 'topics.json').read_text())
        self.emojis = json.loads((root / 'emoji-catalog.json').read_text())
        self.token = token_path.read_text().strip()
        self.http = requests.Session()
        self.http.headers['User-Agent'] = 'TehranHomeCatalogSync/2'
        self.changed = self.sent = self.unchanged = 0
        self.errors = []

    def api(self, method, data, files=None):
        try:
            return self.http.post('https://api.telegram.org/bot' + self.token + '/' + method, data=data, files=files, timeout=(15, 100)).json()
        except Exception:
            return {'ok': False, 'ambiguous': True, 'error_code': 'transport_unknown'}

    def verify(self):
        me = self.api('getMe', {})
        if not me.get('ok') or me['result'].get('username') != BOT:
            raise RuntimeError('bot_identity_invalid')
        self.bot_id = me['result']['id']
        group = self.api('getChat', {'chat_id': CHAT})
        if not group.get('ok') or group['result'].get('title') != GROUP or not group['result'].get('is_forum'):
            raise RuntimeError('group_identity_invalid')
        member = self.api('getChatMember', {'chat_id': CHAT, 'user_id': self.bot_id})
        if member.get('result', {}).get('status') not in ('administrator', 'creator'):
            raise RuntimeError('bot_admin_required')

    def download(self, ad, index, url):
        digest = hashlib.sha256(url.encode()).hexdigest()[:20]
        folder = self.root / 'photos'
        folder.mkdir(exist_ok=True)
        path = folder / (ad['id'] + '-' + digest + '.jpg')
        if path.exists():
            return path
        # Seeded old photos have the original order, only used if URLs match.
        legacy = self.root / 'legacy-photos' / (ad['id'] + '-' + format(index, '02') + '.jpg')
        original = self.state['items'].get(ad['id'], {}).get('ad', {})
        if legacy.exists() and original.get('pics') == ad['pics']:
            raw = legacy.read_bytes()
        else:
            if not url.startswith('https://') or '.divarcdn.com/' not in url:
                raise RuntimeError('untrusted_photo_url:' + ad['id'])
            response = self.http.get(url, timeout=(15, 40))
            response.raise_for_status()
            raw = response.content
        if len(raw) > 15_000_000:
            raise RuntimeError('oversized_photo:' + ad['id'])
        with Image.open(io.BytesIO(raw)) as image:
            image = ImageOps.exif_transpose(image).convert('RGB')
            image.thumbnail((2560, 2560))
            image.save(path, 'JPEG', quality=90)
        return path

    def apply(self, ad, status):
        ident = ad['id']
        old = self.state['items'].get(ident, {})
        content = render(ad, status, self.emojis)
        fingerprint = hashlib.sha256(json.dumps([VERSION, content, ad['pics'], self.topics[ad['category']]], ensure_ascii=False).encode()).hexdigest()
        if old.get('hash') == fingerprint:
            self.unchanged += 1
            return
        editing = bool(old.get('message_id'))
        attempt = self.state['attempts'].get(ident, {})
        if not editing and attempt.get('status') in ('sending', 'unknown'):
            raise RuntimeError('ambiguous_new_send_held:' + ident)
        cached = old.get('file_ids', []) if old.get('ad', {}).get('pics') == ad['pics'] else []
        paths = [] if len(cached) == len(ad['pics']) else [self.download(ad, n, u) for n, u in enumerate(ad['pics'], 1)]
        for retry in range(6):
            if not editing:
                self.state['attempts'][ident] = {'status': 'sending', 'at': time.time(), 'thread': self.topics[ad['category']]}
                save(self.state_path, self.state)
            with contextlib.ExitStack() as stack:
                media, files = [], {}
                for n in range(1, len(ad['pics']) + 1):
                    key = 'p' + str(n)
                    ref = cached[n - 1] if not paths else 'attach://' + key
                    media.append({'id': key, 'media': {'type': 'photo', 'media': ref}})
                    if paths:
                        files[key] = (paths[n - 1].name, stack.enter_context(paths[n - 1].open('rb')), 'image/jpeg')
                rich = {'html': content, 'media': media, 'is_rtl': True, 'skip_entity_detection': True}
                data = {'chat_id': CHAT, 'rich_message': json.dumps(rich, ensure_ascii=False)}
                if editing:
                    data['message_id'] = old['message_id']
                else:
                    data.update(message_thread_id=self.topics[ad['category']], disable_notification='true')
                result = self.api('editMessageText' if editing else 'sendRichMessage', data, files or None)
            if result.get('error_code') == 429:
                if not editing:
                    self.state['attempts'][ident]['status'] = 'rate_limited'
                    save(self.state_path, self.state)
                time.sleep(min(120, int(result.get('parameters', {}).get('retry_after', 30))) + 1)
                continue
            same = editing and result.get('error_code') == 400 and 'message is not modified' in result.get('description', '').lower()
            if not result.get('ok') and not same:
                if not editing:
                    self.state['attempts'][ident].update(status='unknown' if result.get('ambiguous') else 'failed', error_code=result.get('error_code'))
                    save(self.state_path, self.state)
                # Idempotent edits can be reapplied on the next timer run.
                raise RuntimeError(('edit' if editing else 'send') + '_failed:' + ident + ':' + str(result.get('error_code')) + ':' + result.get('description', '')[:160])
            message = result.get('result') if result.get('ok') else {}
            if message and (message.get('chat', {}).get('id') != CHAT or message.get('from', {}).get('id') != self.bot_id):
                raise RuntimeError('receipt_identity_mismatch:' + ident)
            ids = photo_ids(message.get('rich_message', {})) if isinstance(message, dict) else []
            if ids and len(ids) != len(ad['pics']):
                raise RuntimeError('receipt_photo_count_mismatch:' + ident)
            self.state['items'][ident] = {'message_id': old.get('message_id') or message['message_id'], 'thread': self.topics[ad['category']], 'hash': fingerprint, 'status': status, 'ad': ad, 'file_ids': ids or cached, 'synced_at': time.time(), 'photo_count': len(ad['pics'])}
            self.state['attempts'][ident] = {'status': 'confirmed', 'at': time.time()}
            save(self.state_path, self.state)
            self.changed += int(editing)
            self.sent += int(not editing)
            print(json.dumps({'id': ident, 'action': 'edited' if editing else 'sent', 'photos': len(ad['pics']), 'file_ids': len(ids or cached), 'status': status}), flush=True)
            time.sleep(1.2 if editing else 3.1)
            return
        raise RuntimeError('rate_limit_exhausted:' + ident)

    def run(self, only=None, limit=None):
        response = self.http.get(SOURCE, params={'sync': int(time.time())}, timeout=(15, 60))
        response.raise_for_status()
        catalog = response.json()
        if not isinstance(catalog.get('ads'), list) or len(catalog.get('categories', [])) != len(self.topics):
            raise RuntimeError('catalog_schema_invalid')
        save(self.root / 'last-catalog.json', catalog)
        current = {}
        for ad in catalog['ads']:
            if ad.get('category') not in self.topics or not ad.get('pics'):
                continue
            if not 1_000_000 <= ad.get('price', 0) <= 15_000_000:
                continue
            if not 0 <= time.time() - stamp(ad) < 86400:
                continue
            current[ad['id']] = ad
        self.verify()
        work = [(ad, 'active') for ad in current.values()]
        for ident, old in list(self.state['items'].items()):
            if ident not in current and old.get('ad'):
                ad = old['ad']
                status = 'expired' if time.time() - stamp(ad) >= 86400 else 'outside_catalog'
                work.append((ad, status))
        count = 0
        for ad, status in work:
            if only and ad['id'] != only:
                continue
            try:
                self.apply(ad, status)
            except Exception as exc:
                safe = str(exc) if isinstance(exc, (RuntimeError, ValueError)) else type(exc).__name__
                self.errors.append(safe)
                print(json.dumps({'error': safe}), flush=True)
            count += 1
            if limit and count >= limit:
                break
        summary = {'finished_at': datetime.now(timezone.utc).isoformat(), 'edited': self.changed, 'sent': self.sent, 'unchanged': self.unchanged, 'errors': self.errors, 'current_ads': len(current), 'tracked': len(self.state['items']), 'partial_coverage': catalog.get('sourceStatus', {}).get('partial'), 'source_finished_at': catalog.get('sourceStatus', {}).get('lastFinishedAt'), 'sample_only': bool(only or limit)}
        save(self.root / ('sample-summary.json' if only or limit else 'summary.json'), summary)
        print(json.dumps(summary), flush=True)
        if self.errors:
            raise RuntimeError('sync_incomplete:' + str(len(self.errors)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', type=Path, default=Path('/var/lib/tehran-home-sync'))
    parser.add_argument('--token-file', type=Path, default=Path('/etc/aira/secrets/AIRA_BOT_TOKEN'))
    parser.add_argument('--only')
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    args.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (args.state_dir / 'lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('{"status":"already_running"}')
            return
        Sync(args.state_dir, args.token_file).run(args.only, args.limit)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'status': 'failed', 'error': str(exc) if isinstance(exc, (RuntimeError, ValueError)) else type(exc).__name__}), flush=True)
        raise SystemExit(1)
