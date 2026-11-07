# AIRA integration handoff

## Target layout

This preparation is in `online6731/tehran-home-finds`, branch `agent/divar-aira-prep`.
The actual shared bot/site runtime is in `online6731/aiinresearch.ir`.
Inspected checkout: `C:/Users/moham/Documents/Codex/2026-10-02/new-chat/work/aira-platform`.
No files in that checkout were modified by this preparation.

| Existing AIRA point                                                       | Next implementation                                                                                                                                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ai-assistant-bot/aira_capabilities/bridge_contract.py`              | Add Divar capability/action names with request IDs and validated search specs. Keep verified `user_id` as the canonical actor.                                                          |
| `apps/ai-assistant-bot/aira_capabilities/http_bridge.py`                  | Route Divar actions through the existing internal bridge; use Python HMAC client or async equivalent with exact signed raw body.                                                        |
| `packages/runtime-persistence/src/aira_runtime/product_capability_api.py` | Register authenticated shared search/watch/favorite actions and reuse its bot/web session validation. Never trust actor or chat IDs from JSON.                                          |
| `apps/web`                                                                | Add authenticated Divar screen/BFF using shared sessions and API; port the RTL preview components. Read that app's installed Next documentation and AGENTS instructions first.          |
| Existing AIRA rich media and delivery ledger                              | Adapt `renderListing` + all photo URLs; resolve recipient, edit previous receipts, persist partial album progress and reconcile ambiguous sends.                                        |
| Existing runtime scheduler/persistence                                    | Schedule bounded grouped queries with a single lease, quotas, backoff, durable outbox and monitoring. Migrate the preparation SQLite schema to AIRA's shared database when appropriate. |

Follow that repository's AGENTS release requirements when the integration begins: version/CHANGELOG/manifest, required tests and prescribed release/report procedure. Do not introduce a second Telegram update poller or expose the preparation service publicly.

## User flow

1. User describes a need in bot or site.
2. Existing AIRA model emits a **draft** structured search spec plus unresolved questions. Validate with `spec()`; no direct execution of model-provided URLs, recipient IDs or code.
3. Show a concise Persian summary and editable category/city/budget/features. Ask only for consequential ambiguities such as rent/deposit, multi-city, or conflicting ranges.
4. Run bounded search and show complete per-ad galleries, absolute Jalali date/time and honest coverage/inspection state.
5. Explicit save creates a named private watch using a stable operation request ID. Default first scan establishes a silent baseline; user can opt into existing results.
6. User can edit, pause, delete, favorite and open the same state from both surfaces under the canonical actor.
7. Scheduler finds new matches or changed ads. Outbox → verified delivery transport → durable receipt. Changes use prior receipt; ambiguous outcomes stop for reconciliation.

## Rollout gates

- [ ] Shared actor resolution proven for both bot and website; cross-account access tests at the actual runtime boundary.
- [ ] Structured LLM extraction/evaluation including multiple products, Persian numeric words, negation and missing city; no silent broadening.
- [ ] Category schemas for rent/deposit, mileage, property area, salary and category-specific condition semantics; preserve full source feature labels.
- [ ] Source budgets, per-user quota, cache fairness and one scheduler lease; explicit partial-coverage and upstream-429 monitoring.
- [ ] Private database migration, backups, schema versioning, encryption/permissions and retention/erasure policy.
- [ ] Real rich-media staging in a verified test destination, full gallery preservation, message-length fallback and price/detail/gallery edit receipts.
- [ ] Ambiguous receipt reconciliation and adapter tests for crashes after Telegram accepted a send, partial albums and uncertain edits.
- [ ] Explicit policy for definitive removed ads; absence from a bounded search is never sold evidence.
- [ ] Actual AIRA website desktop/mobile accessibility and shared-state checks, consented watch notifications and user timezone presentation.
- [ ] Route the existing Tehran household profile through its adult-only, appliance, rug-size and fingerprinted image-review gates; generic search has its own user-selected rules.
- [ ] Release per target repository instructions; staged rollout/rollback before enabling recurring sends.

## Preparation acceptance

The test suite runs without Telegram credentials or external source calls. It proves search contract, tenancy, baseline/dedup/update behavior, durable receipts, safe ambiguity handling and Python↔Node interoperability. Live source smoke checks are evidence of current endpoint behavior, not full category or production delivery certification.
