import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { spec, specKey, check, text, matches } from "./contracts.mjs";
export class WatchStore {
  constructor(path = ":memory:", { now = Date.now, maxWatches = 50 } = {}) {
    this.now = now;
    this.maxWatches = maxWatches;
    this.db = new DatabaseSync(path);
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if (
      version !== 0 &&
      (version !== 1 ||
        !this.db
          .prepare("PRAGMA table_info(watches)")
          .all()
          .some((c) => c.name === "deleted"))
    ) {
      this.db.close();
      throw Error("schema_migration_required");
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS watches(id TEXT PRIMARY KEY,actor TEXT NOT NULL,name TEXT NOT NULL,spec TEXT NOT NULL,spec_key TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,baseline INTEGER NOT NULL DEFAULT 0,notify_existing INTEGER NOT NULL DEFAULT 0,last_checked INTEGER,status TEXT,request_id TEXT,request_hash TEXT,UNIQUE(actor,request_id));
 CREATE INDEX IF NOT EXISTS watches_actor ON watches(actor,enabled);
 CREATE TABLE IF NOT EXISTS seen(watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,listing_id TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(watch_id,listing_id));
 CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,actor TEXT NOT NULL,watch_id TEXT NOT NULL REFERENCES watches(id),listing_id TEXT NOT NULL,fingerprint TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,claimed_at INTEGER,claim_token TEXT,receipt TEXT);
 CREATE INDEX IF NOT EXISTS events_listing ON events(actor,listing_id);
 CREATE INDEX IF NOT EXISTS events_queue ON events(state,created_at);
 CREATE TABLE IF NOT EXISTS favorites(actor TEXT NOT NULL,listing_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(actor,listing_id));
 PRAGMA user_version=1;`);
  }
  close() {
    this.db.close();
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  actor(v) {
    return text(v, 150);
  }
  view(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      spec: JSON.parse(row.spec),
      version: row.version,
      enabled: !!row.enabled,
      createdAt: row.created_at,
      initialized: !!row.baseline,
      lastChecked: row.last_checked,
      status: row.status ? JSON.parse(row.status) : null,
    };
  }
  read(actor, id) {
    const row = this.db
      .prepare("SELECT * FROM watches WHERE actor=? AND id=? AND deleted=0")
      .get(this.actor(actor), id);
    if (!row) throw Object.assign(new Error("not_found"), { status: 404 });
    return row;
  }
  list(actor) {
    return this.db
      .prepare(
        "SELECT * FROM watches WHERE actor=? AND deleted=0 ORDER BY created_at DESC",
      )
      .all(this.actor(actor))
      .map((r) => this.view(r));
  }
  create(actor, { name, search, notifyExisting = false, requestId = null }) {
    this.actor(actor);
    check(actor.length > 0, "actor_required");
    const s = spec(search);
    text(name, 120);
    check(name.trim().length > 0 && typeof notifyExisting === "boolean");
    if (requestId !== null)
      check(
        typeof requestId === "string" && /^[\w-]{8,100}$/.test(requestId),
        "invalid_request_id",
      );
    const hash = specKey(s) + ":" + name.trim() + ":" + notifyExisting;
    return this.transaction(() => {
      if (requestId) {
        const old = this.db
          .prepare("SELECT * FROM watches WHERE actor=? AND request_id=?")
          .get(actor, requestId);
        if (old) {
          check(old.request_hash === hash, "idempotency_conflict");
          if (old.deleted)
            throw Object.assign(Error("request_already_deleted"), {
              status: 409,
            });
          return this.view(old);
        }
      }
      check(
        this.db
          .prepare(
            "SELECT count(*) AS n FROM watches WHERE actor=? AND deleted=0",
          )
          .get(actor).n < this.maxWatches,
        "watch_limit",
      );
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO watches(id,actor,name,spec,spec_key,created_at,baseline,notify_existing,request_id,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          actor,
          name.trim(),
          JSON.stringify(s),
          specKey(s),
          this.now(),
          notifyExisting ? 1 : 0,
          Number(notifyExisting),
          requestId,
          hash,
        );
      return this.view(this.read(actor, id));
    });
  }
  update(actor, id, { version, name, search, enabled }) {
    return this.transaction(() => {
      const r = this.read(actor, id);
      if (version !== r.version)
        throw Object.assign(new Error("version_conflict"), { status: 409 });
      check(enabled === undefined || typeof enabled === "boolean");
      if (name !== undefined) {
        text(name, 120);
        check(name.trim().length > 0);
      }
      const s = search === undefined ? JSON.parse(r.spec) : spec(search),
        changed = specKey(s) !== r.spec_key;
      this.db
        .prepare(
          "UPDATE watches SET name=?,spec=?,spec_key=?,enabled=?,version=version+1,baseline=? WHERE id=?",
        )
        .run(
          name?.trim() ?? r.name,
          JSON.stringify(s),
          specKey(s),
          enabled === undefined ? r.enabled : Number(enabled),
          changed || (enabled === true && !r.enabled) ? 0 : r.baseline,
          id,
        );
      // Cancel unsent events before pause/edit. A claimed send requires reconciliation.
      if (changed || enabled === false) this.rehomePending(r.actor, id);
      if (changed) this.db.prepare("DELETE FROM seen WHERE watch_id=?").run(id);
      return this.view(this.read(actor, id));
    });
  }
  rehomePending(actor, id) {
    for (const event of this.db
      .prepare("SELECT * FROM events WHERE watch_id=? AND state='pending'")
      .all(id)) {
      const ad = JSON.parse(event.payload).listing;
      const replacement = this.db
        .prepare(
          "SELECT * FROM watches WHERE actor=? AND enabled=1 AND deleted=0 AND id!=? ORDER BY created_at",
        )
        .all(actor, id)
        .find((w) => matches(ad, JSON.parse(w.spec), this.now()));
      if (replacement) {
        const payload = {
          ...JSON.parse(event.payload),
          watchName: replacement.name,
        };
        this.db
          .prepare("UPDATE events SET watch_id=?,payload=? WHERE id=?")
          .run(replacement.id, JSON.stringify(payload), event.id);
      } else
        this.db
          .prepare("UPDATE events SET state='cancelled' WHERE id=?")
          .run(event.id);
    }
  }
  remove(actor, id) {
    return this.transaction(() => {
      this.read(actor, id);
      check(
        !this.db
          .prepare(
            "SELECT id FROM events WHERE watch_id=? AND state IN ('claimed','unknown')",
          )
          .get(id),
        "delivery_requires_reconciliation",
      );
      this.db
        .prepare(
          "UPDATE watches SET deleted=1,enabled=0 WHERE actor=? AND id=?",
        )
        .run(actor, id);
      this.rehomePending(actor, id);
      this.db.prepare("DELETE FROM seen WHERE watch_id=?").run(id);
    });
  }
  runnable() {
    return this.db
      .prepare(
        "SELECT * FROM watches WHERE enabled=1 AND deleted=0 ORDER BY created_at",
      )
      .all();
  }
  ingest(watch, result) {
    return this.transaction(() => {
      const current = this.db
        .prepare("SELECT * FROM watches WHERE id=?")
        .get(watch.id);
      if (!current?.enabled || current.version !== watch.version)
        return { queued: 0, stale: true };
      check(
        Array.isArray(result.ads) && typeof result.coverage === "string",
        "invalid_provider_result",
      );
      const now = this.now(),
        s = JSON.parse(current.spec);
      let queued = 0;
      // Positive newer detail evidence invalidates an unsent stale payload,
      // including a price change that no longer matches. Absence proves nothing.
      for (const ad of result.observed || []) {
        for (const event of this.db
          .prepare(
            "SELECT id,payload FROM events WHERE actor=? AND listing_id=? AND state='pending' AND fingerprint!=?",
          )
          .all(current.actor, ad.id, ad.fingerprint)) {
          const previous = JSON.parse(event.payload).listing;
          if ((ad.verifiedAt || 0) >= (previous.verifiedAt || 0))
            this.db
              .prepare("UPDATE events SET state='cancelled' WHERE id=?")
              .run(event.id);
        }
      }
      for (const ad of result.ads) {
        if (!matches(ad, s, now)) continue;
        const old = this.db
          .prepare(
            "SELECT fingerprint FROM seen WHERE watch_id=? AND listing_id=?",
          )
          .get(watch.id, ad.id);
        if (
          current.baseline &&
          old?.fingerprint !== ad.fingerprint &&
          (old || ad.postedAt >= current.created_at || current.notify_existing)
        ) {
          const kind = old ? "updated" : "new",
            payload = {
              listing: ad,
              watchName: current.name,
              coverage: result.coverage,
            };
          this.db
            .prepare(
              "UPDATE events SET state='cancelled' WHERE actor=? AND listing_id=? AND state='pending' AND fingerprint!=?",
            )
            .run(current.actor, ad.id, ad.fingerprint);
          const last = this.db
            .prepare(
              "SELECT fingerprint FROM events WHERE actor=? AND listing_id=? AND state IN ('pending','claimed','unknown','sent') ORDER BY rowid DESC LIMIT 1",
            )
            .get(current.actor, ad.id);
          if (last?.fingerprint !== ad.fingerprint)
            queued += Number(
              this.db
                .prepare(
                  "INSERT INTO events(id,actor,watch_id,listing_id,fingerprint,kind,payload,created_at) VALUES(?,?,?,?,?,?,?,?)",
                )
                .run(
                  randomUUID(),
                  current.actor,
                  watch.id,
                  ad.id,
                  ad.fingerprint,
                  kind,
                  JSON.stringify(payload),
                  now,
                ).changes,
            );
        }
        this.db
          .prepare(
            "INSERT INTO seen VALUES(?,?,?) ON CONFLICT(watch_id,listing_id) DO UPDATE SET fingerprint=excluded.fingerprint",
          )
          .run(watch.id, ad.id, ad.fingerprint);
      }
      // Failed retrieval never establishes an empty baseline or declares anything sold.
      const baseline =
        result.coverage === "source-unavailable" ? current.baseline : 1;
      this.db
        .prepare(
          "UPDATE watches SET baseline=?,last_checked=?,status=? WHERE id=?",
        )
        .run(
          baseline,
          now,
          JSON.stringify({
            coverage: result.coverage,
            errors: result.errors || [],
            count: result.ads.length,
          }),
          watch.id,
        );
      return { queued, baseline: !!baseline };
    });
  }
  events(actor) {
    return this.db
      .prepare(
        "SELECT id,watch_id,kind,state,created_at,payload FROM events WHERE actor=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(this.actor(actor))
      .map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }
  claim(limit = 10, leaseMs = 120000) {
    check(Number.isInteger(limit) && limit > 0 && limit <= 100);
    return this.transaction(() => {
      // An interrupted request may already have reached Telegram. Never auto-retry it.
      this.db
        .prepare(
          "UPDATE events SET state='unknown' WHERE state='claimed' AND claimed_at<?",
        )
        .run(this.now() - leaseMs);
      this.db
        .prepare(
          "UPDATE events SET state='expired' WHERE state='pending' AND created_at<?",
        )
        .run(this.now() - 86400000);
      const rows = this.db
        .prepare(
          "SELECT e.* FROM events e JOIN watches w ON w.id=e.watch_id WHERE e.state='pending' AND w.enabled=1 ORDER BY e.created_at LIMIT ?",
        )
        .all(limit);
      const claimed = [];
      for (const r of rows) {
        const payload = JSON.parse(r.payload),
          s = JSON.parse(
            this.db
              .prepare("SELECT spec FROM watches WHERE id=?")
              .get(r.watch_id).spec,
          );
        if (!matches(payload.listing, s, this.now())) {
          this.db
            .prepare("UPDATE events SET state='expired' WHERE id=?")
            .run(r.id);
          continue;
        }
        if (
          this.db
            .prepare(
              "SELECT id FROM events WHERE actor=? AND listing_id=? AND state IN ('claimed','unknown') AND id!=?",
            )
            .get(r.actor, r.listing_id, r.id)
        )
          continue;
        const previous = this.db
          .prepare(
            "SELECT receipt FROM events WHERE actor=? AND listing_id=? AND state='sent' ORDER BY rowid DESC LIMIT 1",
          )
          .get(r.actor, r.listing_id);
        const token = randomUUID();
        this.db
          .prepare(
            "UPDATE events SET state='claimed',claimed_at=?,claim_token=? WHERE id=?",
          )
          .run(this.now(), token, r.id);
        claimed.push({
          id: r.id,
          actor: r.actor,
          kind: r.kind,
          claimToken: token,
          idempotencyKey: r.id,
          previousReceipt: previous?.receipt || null,
          payload,
        });
      }
      return claimed;
    });
  }
  readyToSend(id, claimToken, leaseMs = 120000) {
    return this.transaction(() => {
      const e = this.db
        .prepare(
          "SELECT * FROM events WHERE id=? AND claim_token=? AND state='claimed'",
        )
        .get(id, claimToken);
      if (!e) return false;
      if (e.claimed_at < this.now() - leaseMs) {
        this.db.prepare("UPDATE events SET state='unknown' WHERE id=?").run(id);
        return false;
      }
      const w = this.db
        .prepare("SELECT * FROM watches WHERE id=?")
        .get(e.watch_id);
      if (
        !w?.enabled ||
        w.deleted ||
        !matches(JSON.parse(e.payload).listing, JSON.parse(w.spec), this.now())
      ) {
        this.db
          .prepare(
            "UPDATE events SET state='cancelled',claim_token=NULL WHERE id=?",
          )
          .run(id);
        return false;
      }
      return true;
    });
  }
  acknowledge(
    id,
    claimToken,
    { state, receipt = null, requestNotSent = false },
  ) {
    check(
      ["sent", "unknown", "retry"].includes(state),
      "invalid_delivery_state",
    );
    if (receipt !== null) text(receipt, 300);
    if (state === "sent") check(!!receipt, "receipt_required");
    if (state === "retry")
      check(requestNotSent === true, "unsent_proof_required");
    const target = state === "retry" ? "pending" : state;
    // retry is allowed ONLY when the adapter proves no outbound request was made.
    const changes = this.db
      .prepare(
        "UPDATE events SET state=?,receipt=?,claim_token=? WHERE id=? AND claim_token=? AND state IN ('claimed','unknown')",
      )
      .run(
        target,
        receipt,
        state === "unknown" ? claimToken : null,
        id,
        claimToken,
      ).changes;
    if (!changes)
      throw Object.assign(new Error("claim_conflict"), { status: 409 });
  }
  favorite(actor, ad, enabled) {
    check(typeof enabled === "boolean");
    check(ad && /^[\w-]{4,64}$/.test(ad.id), "invalid_listing");
    if (enabled)
      this.db
        .prepare(
          "INSERT INTO favorites VALUES(?,?,?) ON CONFLICT(actor,listing_id) DO UPDATE SET payload=excluded.payload",
        )
        .run(this.actor(actor), ad.id, JSON.stringify(ad));
    else
      this.db
        .prepare("DELETE FROM favorites WHERE actor=? AND listing_id=?")
        .run(this.actor(actor), ad.id);
  }
  favorites(actor) {
    return this.db
      .prepare("SELECT payload FROM favorites WHERE actor=?")
      .all(this.actor(actor))
      .map((r) => JSON.parse(r.payload));
  }
}
