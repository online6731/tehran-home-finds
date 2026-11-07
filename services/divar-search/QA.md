# Verification — 2026-10-16

Preparation scope: `agent/divar-aira-prep`, Node 24.18.0, Python 3.11.9, Windows PowerShell. No production AIRA files, delivery credentials or scheduler were changed.

## Automated evidence

`npm test`: **50 passed, 0 failed**, including **28 new search integration tests** and all existing 22 catalog tests. Tests use synthetic public-source fixtures and memory/temporary SQLite, not real Telegram sends.

Covered: all-category contract validation, category ancestry, Persian digits and money, explicit rental/multi-city ambiguity, missing/old/unknown-price rejection, private actor isolation, optimistic edits, idempotent create, first baseline, backfill, overlapping-watch deduplication, deletion retaining receipts, reverting prices, price outside filter cancelling stale pending work, SQLite reopen/two-connection claims, crash/timeout stopping repeats, lease recheck before later sends, source cache/coalescing/fallback, fast 429 cooldown, full gallery/absolute timestamp parsing, car group/base-price and seller-score separation, HTML escaping and actual Python client ↔ Node signed API interoperability.

CI workflow `divar-search-tests.yml` runs the suite on Ubuntu with Node 24.18.0 and Python 3.11; GitHub result is separate from the local result.

## Live public-source probe

Command: `node services/divar-search/smoke.mjs --live`.
At **2026-10-16T11:41:02Z**, bounded to four details and one page per query:

| Query                            | Details scanned | Matches | Galleries           | Coverage/errors           |
| -------------------------------- | --------------: | ------: | ------------------- | ------------------------- |
| Tehran / mobile-phones / سامسونگ |               4 |       3 | 7, 3, 1 photos      | partial-source, no errors |
| Shiraz / light / پژو             |               4 |       4 | 8, 5, 4, 9 photos   | partial-source, no errors |
| Tehran / apartment-sell          |               4 |       4 | 11, 5, 1, 11 photos | partial-source, no errors |

Original dates and distinct price labels (`قیمت`, `قیمت پایه`, `قیمت کل`) were returned and parsed. Live samples include ids `gaS3AEhZ`, `gaL34K3m`, `gaPvXIHk`. All photos were preserved as public URLs. This is transport/parser verification, not visual quality review of ads.

An earlier probe encountered HTTP 404/client-only SSR shells and city-resolution errors. The service now falls back to the public list API and uses documented, verified Tehran/Shiraz city IDs when base pages also return shells. Unknown cities still fail closed; no invented city IDs. Both supported cities were first verified against their public base-page selected city data. Query text was observed in Divar's action-log search metadata.

## Browser evidence

Local page `http://127.0.0.1:18473`:

- Persian text → mobile category, 20m toman cap and **both** used/like-new conditions were visibly preserved.
- Watch created, edited in place, paused and its changed state verified through the visible UI.
- Live default-window mobile search returned **19 matches**, explicitly partial and unreviewed.
- Gallery advanced from image 1/2 to 2/2; favorite saved and verified in the separate favorites tab.
- Desktop and mobile viewport inspected visually; a photo-overflow defect exposed by the mobile check was fixed by constraining the media image to its positioned container. A category-select width overflow was also fixed with zero-minimum grid columns and bounded inputs. Final mobile check: CSS viewport 488px, document width 469px, image and media both 250px. Browser console had no captured errors.

The browser viewport capability was requested at 390×844; the app reported a CSS viewport of 488px wide due to host scaling. Record the actual CSS width when reproducing responsive checks. Final UI screenshot accompanies the local handoff.

## Remaining gates

No real Telegram send/edit, shared AIRA login, LLM interpretation, PostgreSQL migration, production load or all-237-category live coverage was claimed. See INTEGRATION.md. The existing household workflow remains a separate profile with its own filters and image reviews.
