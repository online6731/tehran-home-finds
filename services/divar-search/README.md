# AIRA × Divar — integration preparation

نسخهٔ آماده‌سازی برای جست‌وجو، واچ‌لیست خصوصی و اعلان در **همهٔ دسته‌های دیوار**. این ماژول پیش‌نمایش محلی و هستهٔ قابل اتصال است. ورود مشترک آیرا، مدل زبانی و ارسال واقعی تلگرام در مرحلهٔ ادغام وصل می‌شوند.

## Run

Requires **Node 24.18+** and Python 3.11+ for the bridge interoperability test. No npm dependencies or bot token required.

```powershell
npm run search:dev
# http://127.0.0.1:18473
npm run test:search
npm test
```

The existing household catalog still runs on Node 22. Only the new search service requires Node 24.18+ (`node:sqlite`). `search:dev` binds loopback, uses an HttpOnly SameSite session and stores private state under ignored `private-data/`. It does not start Telegram delivery or background scans. `--poll` explicitly enables a five-minute in-process scan into the outbox; it still sends nothing.

`DIVAR_DB` overrides the SQLite path; `PORT` defaults to 18473. SIGINT/SIGTERM close the server and database. The browser preview identity expires after 24 hours and is not an AIRA account. Losing that cookie does not restore an old identity; use verified shared sessions in production.

## Implemented

- Captured public category tree: **237 nodes, including ROOT**, across all 10 top-level branches. Category ancestry is checked again against each detail response.
- Editable Persian intent suggestions, normalized Persian/Arabic digits, budget/rial conversion, city, category, condition and exclusions. Rule based, not an LLM. Ambiguities and unsupported interpretation are shown before saving.
- Arbitrary validated city slugs; ten popular suggestions. City IDs are resolved from public city pages. Evidence-backed Tehran/​​Shiraz IDs are retained in `data/divar-cities.json` for shell-page fallback; detail city slugs are always rechecked. Unknown/unavailable cities fail explicitly.
- Generic detail parsing without the household price/category restrictions: all photo URLs, original absolute publication, group fields, nested feature modals and seller assessments. Car base price is supported. Public video URLs are retained separately.
- Search, editable named watchlists, pause/resume/delete, favorites and notification status in an RTL responsive preview.
- Private actor-scoped SQLite persistence with WAL, transactions, optimistic watch versions and optional create request idempotency.
- Silent initial baseline by default; opt-in existing results. New matches and changed fingerprints enter a receipted outbox. Overlapping watches share queries and deduplicate delivery per actor/listing state.
- Durable send history survives watch deletion; deletion is a tombstone, not an erasure of receipts. Pending work is reassigned to another matching active watch when possible.
- Crash or ambiguous network delivery becomes `unknown` and blocks automatic repeats. Previously sent receipt is passed to the adapter for edits. Price returning to an earlier value is also an update.
- Exact Persian weekday, Jalali date and Tehran time. No relative `tg-time` in message templates. Seller text is escaped. Images remain explicitly unreviewed; technical condition is never certified.
- Positive newer detail evidence cancels an unsent old price even if the updated listing no longer matches. No exit/sold notification is inferred.
- Bounded caches, same-query coalescing, serialized source requests, timeout, 429 backoff, page/detail bounds, partial coverage and a public API fallback when SSR is a shell.

## API and authentication

All application endpoints are **POST JSON**. `/healthz` is GET. Requests reject unknown fields. Static preview is served at `/`. These loopback endpoints are not a public internet API.

| Route                | Payload                                  |
| -------------------- | ---------------------------------------- |
| `/api/meta`          | `{}`                                     |
| `/api/intent`        | `{text}`                                 |
| `/api/search`        | `{spec}`                                 |
| `/api/watch/list`    | `{}`                                     |
| `/api/watch/create`  | `{name,spec,notifyExisting?,requestId?}` |
| `/api/watch/update`  | `{id,version,name?,spec?,enabled?}`      |
| `/api/watch/delete`  | `{id}`                                   |
| `/api/favorites`     | `{}`                                     |
| `/api/favorite`      | `{listing,enabled}`                      |
| `/api/notifications` | `{}`                                     |

`requestId` is 8–100 ASCII word/hyphen characters, unique per actor. Reuse the same key and original body after a timeout. Changed body gives `idempotency_conflict`; replay after deletion gives 409. After a successful operation generate a new key. Preview creates a UUID per save operation.

The v1 search contract:

```json
{
  "version": 1,
  "query": "سامسونگ",
  "city": "tehran",
  "category": "mobile-phones",
  "minPrice": 5000000,
  "maxPrice": 20000000,
  "conditions": ["کارکرده", "در حد نو"],
  "areas": ["ونک"],
  "exclude": ["شکسته"],
  "maxAgeHours": 24,
  "requirePhotos": true,
  "fields": { "حافظهٔ داخلی": "۲۵۶ گیگابایت" }
}
```

Prices are toman, null means unrestricted, age 1–168 hours. `fields` compares normalized exact public field labels/values. Query words must all occur in title/description/fields. All local filters apply after bounded detail retrieval, so a zero count is **not** proof that the whole city has no match. Source links carry only query/city/category/price.

Production mode requires a key file containing at least 32 random bytes represented as a UTF-8 secret, referenced by `DIVAR_BRIDGE_KEY_FILE`. Never commit it. The existing AIRA backend signs requests; the browser never receives the key. The service requires loopback Host. A future BFF should proxy it server-to-server rather than exposing it directly.

HMAC-SHA256 input is the exact UTF-8 bytes of six fields, joined by a newline:

```text
timestamp_in_milliseconds
nonce
verified_actor
POST
/api/route
exact_raw_JSON_body
```

Headers: `X-Aira-Timestamp`, `X-Aira-Nonce`, `X-Aira-Actor`, `X-Aira-Signature` (hex). Timestamp tolerance ±60 seconds, nonce single use for two minutes. Actor must come from a **verified AIRA session**, never user text, callback data or a chosen chat ID. Use `aira_client.py` for Python; it has no dependency on Telegram and ignores system proxies for loopback calls. An async AIRA handler should call this synchronous client via `asyncio.to_thread`, or port the identical signature contract to its existing httpx client.

For in-process integration, `createApp({authenticate})` accepts a trusted session adapter, returning the canonical verified actor or failing closed. Local preview mode must remain disabled in a deployed environment. Current limits: 60 calls/minute/actor, four searches in flight and 50 active stored watches/actor. Add shared global admission control before multi-user rollout.

## Scan and delivery contract

```js
const worker = new WatchWorker(store, provider);
await worker.tick(); // no sends; equivalent active specs coalesce
await deliverPending(store, verifiedAiraTransport);
```

One worker instance skips overlapping ticks. SQLite transactions serialize multiple local connections; duplicate scans are safe for notification deduplication but are wasteful for source access. Run one scheduler on the target host and add a distributed lease before multi-host deployment.

A transport receives `{id,actor,kind,claimToken,idempotencyKey,previousReceipt,payload}`. Resolve the recipient through AIRA's verified binding and preferences. It must:

1. Persist intent/idempotency before any outbound operation.
2. Send the complete gallery using AIRA's existing rich-media transport and category/user destination policy.
3. If `previousReceipt` exists, edit/update that delivery instead of sending a fresh duplicate. A changed gallery needs the existing transport's replacement/reconciliation policy.
4. Return `{id: durableReceiptReference}` only after the existing AIRA receipt ledger is committed. The reference is at most 300 characters; store long Telegram receipt structures in the AIRA ledger.
5. Throw with `requestNotSent: true` **only with positive evidence no outbound request occurred**. Timeouts and partial album sends become `unknown`; do not retry them automatically.

Claims expire to `unknown` after two minutes. Claimed events are protected from another connection. Old pending events expire after 24 hours and listing eligibility is rechecked before claim. Unknown/claimed events block later versions of the same actor/listing. Keep claim credentials in trusted internal persistence; `store.acknowledge(id,claimToken,{state:'sent',receipt})` reconciles a verified existing receipt, while retry requires `{state:'retry',requestNotSent:true}`. No browser endpoint can acknowledge or choose a Telegram destination.

The system does not infer sold/deleted from absence in a partial search. A definitive source removal/edit policy must be connected to the existing AIRA transport during integration. No exactly-once guarantee is claimed for an external network: ambiguity is stopped for reconciliation.

## Integration into the actual AIRA bot and website

Read [INTEGRATION.md](./INTEGRATION.md) for exact adapter points and rollout gates. The shared identity and persistence contract is deliberately the same for both surfaces. No independent Telegram poller is introduced.

## Known limits

- Taxonomy support covers all captured categories structurally. Each of the 237 nodes has not been live tested; a category can change or disappear upstream.
- Natural-language extraction is an editable baseline. Complex negation, multiple cities/items and numeric words need the existing AIRA model plus structured validation/confirmation.
- Category-specific range filters (rent versus deposit, mileage, area, salary) require dynamic schemas in the next phase. Current exact `fields` supports explicit features; a generic price must never be presented as covering both rent and deposit.
- Default source window: at most 24 details and two list pages, 2 seconds between requests, 20 second HTTP timeout, 60 second cache. Sponsored/bumped ads can be old; only original absolute posting is eligible. No pagination completeness promise or notification latency SLA.
- Only public anonymous content is used. No seller phone/contact/login data. The anonymous endpoints can change or rate limit. No official Divar partnership/API entitlement is claimed.
- Photos are preserved, not visually reviewed. Household quality/audience rules remain in the existing household profile and must be explicitly routed when integrating that profile.
- SQLite is a single-host preparation store. There is no production migration/import from AIRA yet. Schema v1 is a fresh preparation schema; do not point this build at an earlier experimental DB.
- Deleted-watch receipts/tombstones are retained for deduplication. A production retention/erasure policy and a recovery UI for ambiguous delivery still need integration.
- Delivery renderer produces the existing custom rich-media draft structure; real transport compatibility and real Telegram receipts remain rollout gates.

See [QA.md](./QA.md) for actual test evidence.
