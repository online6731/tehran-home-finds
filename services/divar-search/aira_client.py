"""Preparation client for AIRA's existing authenticated bot/web runtime.

actor MUST come from its verified session, never text or callback JSON.
No Telegram poller, credentials, recipient selection or sends live here.
"""
import hashlib
import hmac
import json
import time
import uuid
import urllib.request
from urllib.parse import urlparse


class DivarClient:
    def __init__(self, base_url, key, timeout=120):
        url = urlparse(base_url)
        if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost') or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
            raise ValueError('loopback_bridge_required')
        if len(key) < 32:
            raise ValueError('bridge_key_too_short')
        self.base_url, self.key, self.timeout = base_url.rstrip('/'), key, timeout

    def call(self, verified_actor, route, payload):
        allowed = {'meta', 'intent', 'search', 'watch/list', 'watch/create', 'watch/update', 'watch/delete', 'favorites', 'favorite', 'notifications'}
        if route not in allowed or not isinstance(verified_actor, str) or not verified_actor or len(verified_actor) > 150 or '\n' in verified_actor:
            raise ValueError('invalid_bridge_request')
        body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()
        stamp, nonce, target = str(int(time.time()*1000)), uuid.uuid4().hex, '/api/' + route
        message = '\n'.join([stamp, nonce, verified_actor, 'POST', target]).encode() + b'\n' + body
        signature = hmac.new(self.key, message, hashlib.sha256).hexdigest()
        request = urllib.request.Request(self.base_url + target, data=body, method='POST', headers={
            'Content-Type': 'application/json', 'X-Aira-Actor': verified_actor,
            'X-Aira-Timestamp': stamp, 'X-Aira-Nonce': nonce, 'X-Aira-Signature': signature,
        })
        # Never inherit system proxies for a credential-bearing loopback request.
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=self.timeout) as response:
            return json.load(response)
