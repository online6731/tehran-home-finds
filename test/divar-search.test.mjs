import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  spec,
  parseIntent,
  normalize,
  matches,
  taxonomy,
} from "../services/divar-search/contracts.mjs";
import { WatchStore } from "../services/divar-search/store.mjs";
import {
  WatchWorker,
  deliverPending,
} from "../services/divar-search/worker.mjs";
import {
  parseDetail,
  PublicDivarProvider,
} from "../services/divar-search/provider.mjs";
import { createApp, signature } from "../services/divar-search/server.mjs";
import { renderListing } from "../services/divar-search/render.mjs";
let now = Date.parse("2026-10-16T10:00:00Z");
const listing = (id = "test1234", extra = {}) => ({
  id,
  title: "گوشی سامسونگ",
  citySlug: "tehran",
  category: "mobile-phones",
  area: "ونک",
  desc: "تمیز",
  fields: {},
  price: 20000000,
  condition: "کارکرده",
  postedAt: now - 1000,
  pics: ["https://s100.divarcdn.com/a.webp"],
  fingerprint: "f1",
  ...extra,
});
const result = (ads) => ({ ads, coverage: "partial-source", errors: [] });
const store = () => new WatchStore(":memory:", { now: () => now });
test("all categories preserve general domains and no household price ceiling", () => {
  assert.equal(taxonomy.categories.length, 237);
  for (const category of [
    "ROOT",
    "mobile-phones",
    "apartment-rent",
    "light",
    "services",
  ])
    assert.equal(spec({ category, maxPrice: 4e9 }).maxPrice, 4e9);
  assert.equal(spec({ city: "shiraz" }).city, "shiraz");
  assert.throws(() => spec({ category: "invented" }));
  assert.throws(() => spec({ minPrice: 5, maxPrice: 4 }));
  assert.throws(() => spec({ actor: "other" }));
  assert.throws(() => spec({ city: "../evil" }));
});
test("Persian digits, Arabic letters, price range shared units and explicit rial", () => {
  assert.equal(normalize("كمد ۱۲٣"), "کمد 123");
  const a = parseIntent("گوشی سامسونگ کارکرده تهران تا ۲۰ میلیون تومان میخوام");
  assert.equal(a.spec.maxPrice, 20e6);
  assert.equal(a.spec.category, "mobile-phones");
  assert.equal(a.spec.city, "tehran");
  assert(!a.spec.query.includes("میخوام"));
  const b = parseIntent("مبل تهران از ۵ تا ۱۲ میلیون تومان");
  assert.equal(b.spec.minPrice, 5e6);
  assert.equal(b.spec.maxPrice, 12e6);
  assert.equal(parseIntent("مبل تا ۵۰۰۰۰۰۰۰ ریال تهران").spec.maxPrice, 5e6);
  assert(parseIntent("یه ماشین ارزون").questions.length);
});
test("matches refuses unknown numeric price, wrong city, old/future date and missing field", () => {
  const s = spec({ query: "سامسونگ", maxPrice: 25e6 });
  assert(matches(listing(), s, now));
  for (const extra of [
    { price: null },
    { citySlug: "karaj" },
    { postedAt: now + 1 },
    { postedAt: now - 25 * 3600000 },
    { pics: [] },
    { title: "آیفون" },
  ])
    assert(!matches(listing("test1234", extra), s, now));
  assert(!matches(listing(), spec({ fields: { حافظه: "256" } }), now));
});
test("tenant isolation and optimistic edit versions", () => {
  const db = store();
  try {
    const w = db.create("a", { name: "موبایل", search: {} });
    assert.equal(db.list("b").length, 0);
    assert.throws(() => db.read("b", w.id), /not_found/);
    assert.throws(
      () => db.update("b", w.id, { version: 1, enabled: false }),
      /not_found/,
    );
    assert.throws(
      () => db.update("a", w.id, { version: 2 }),
      /version_conflict/,
    );
    assert.equal(
      db.update("a", w.id, { version: 1, enabled: false }).enabled,
      false,
    );
  } finally {
    db.close();
  }
});
test("baseline, new listing, persistent dedup, pause, no sold inference on absence", () => {
  const db = store();
  try {
    let w = db.create("a", { name: "x", search: {} });
    db.ingest(db.read("a", w.id), result([listing()]));
    assert.equal(db.events("a").length, 0);
    const ad = listing("new12345", { postedAt: now + 100 });
    now += 200;
    db.ingest(db.read("a", w.id), result([ad]));
    db.ingest(db.read("a", w.id), result([ad]));
    assert.equal(db.events("a").length, 1);
    db.ingest(db.read("a", w.id), result([]));
    assert.equal(db.events("a").length, 1);
    db.update("a", w.id, { version: 1, enabled: false });
    assert.equal(db.claim().length, 0);
  } finally {
    db.close();
  }
});
test("failed source does not initialize; old unseen backfill is not a fresh ad", () => {
  const db = store();
  try {
    const w = db.create("a", { name: "x", search: {} });
    db.ingest(db.read("a", w.id), { ads: [], coverage: "source-unavailable" });
    assert(!db.view(db.read("a", w.id)).initialized);
    db.ingest(db.read("a", w.id), result([]));
    db.ingest(
      db.read("a", w.id),
      result([listing("old12345", { postedAt: now - 5000 })]),
    );
    assert.equal(db.events("a").length, 0);
  } finally {
    db.close();
  }
});
test("equivalent watches share retrieval and cross-watch notifications deduplicate", async () => {
  const db = store();
  try {
    db.create("a", { name: "one", search: {}, notifyExisting: true });
    db.create("a", { name: "two", search: {}, notifyExisting: true });
    db.create("b", { name: "three", search: {}, notifyExisting: true });
    let calls = 0;
    const worker = new WatchWorker(db, {
      search: async () => {
        calls++;
        return result([listing()]);
      },
    });
    await worker.tick();
    assert.equal(calls, 1);
    assert.equal(db.events("a").length, 1);
    assert.equal(db.events("b").length, 1);
  } finally {
    db.close();
  }
});
test("crash lease becomes unknown; updated listing blocks until reconciliation", () => {
  const db = store();
  try {
    const w = db.create("a", { name: "x", search: {}, notifyExisting: true });
    db.ingest(db.read("a", w.id), result([listing()]));
    const [first] = db.claim();
    assert(first);
    now += 130000;
    assert.equal(db.claim().length, 0);
    assert.equal(db.events("a")[0].state, "unknown");
    db.ingest(
      db.read("a", w.id),
      result([listing("test1234", { fingerprint: "f2", price: 19e6 })]),
    );
    assert.equal(db.claim().length, 0);
    db.acknowledge(first.id, first.claimToken, {
      state: "sent",
      receipt: "receipt-1",
    });
    const [second] = db.claim();
    assert.equal(second.previousReceipt, "receipt-1");
    assert.equal(second.kind, "updated");
  } finally {
    db.close();
  }
});
test("pending price updates coalesce; explicit pre-send failure can retry", async () => {
  const db = store();
  try {
    const w = db.create("a", { name: "x", search: {}, notifyExisting: true });
    db.ingest(db.read("a", w.id), result([listing()]));
    db.ingest(
      db.read("a", w.id),
      result([listing("test1234", { fingerprint: "f2", price: 15e6 })]),
    );
    assert.equal(db.events("a").filter((e) => e.state === "pending").length, 1);
    await deliverPending(db, {
      send: async () => {
        throw Object.assign(Error("offline"), { requestNotSent: true });
      },
    });
    assert.equal(db.events("a").filter((e) => e.state === "pending").length, 1);
    await deliverPending(db, {
      send: async () => {
        throw Error("timeout");
      },
    });
    assert.equal(db.events("a").filter((e) => e.state === "unknown").length, 1);
  } finally {
    db.close();
  }
});
test("worker ignores stale results after edited watch", async () => {
  const db = store();
  try {
    const w = db.create("a", { name: "x", search: {}, notifyExisting: true });
    const old = db.read("a", w.id);
    db.update("a", w.id, { version: 1, enabled: false });
    assert(db.ingest(old, result([listing()])).stale);
    assert.equal(db.events("a").length, 0);
  } finally {
    db.close();
  }
});
const rawDetail = () => ({
  city: { city_id: "1", second_slug: "tehran" },
  seo: {
    post_seo_schema: { category: "mobile-phones" },
    web_info: {
      title: "گوشی سامسونگ",
      district_persian: "ونک",
      category_slug_persian: "موبایل",
    },
  },
  sections: [
    {
      section_name: "TITLE",
      widgets: [
        {
          widget_type: "EXPANDABLE_SECTION",
          data: {
            title: "یک ساعت پیش در ونک",
            description: "انتشار آگهی: ۲۴ مهر ۱۴۰۵، ۱۳:۰۰",
          },
        },
      ],
    },
    {
      section_name: "LIST_DATA",
      widgets: [
        {
          widget_type: "UNEXPANDABLE_ROW",
          data: { title: "قیمت", value: "۲۰,۰۰۰,۰۰۰ تومان" },
        },
        {
          widget_type: "UNEXPANDABLE_ROW",
          data: { title: "وضعیت", value: "کارکرده" },
        },
      ],
    },
    {
      section_name: "IMAGE",
      widgets: [
        {
          widget_type: "IMAGE_CAROUSEL",
          data: {
            items: [
              { image: { url: "https://s100.divarcdn.com/a.webp" } },
              { image: { url: "https://s100.divarcdn.com/b.webp" } },
              { image: { url: "http://127.0.0.1/private" } },
            ],
          },
        },
      ],
    },
    {
      section_name: "DESCRIPTION",
      widgets: [{ widget_type: "DESCRIPTION_ROW", data: { text: "تمیز" } }],
    },
  ],
});
test("generic detail preserves full gallery and absolute posting time; refuses relative", () => {
  const raw = rawDetail(),
    a = parseDetail(raw, "test1234", now);
  assert.equal(a.price, 20e6);
  assert.equal(a.pics.length, 2);
  assert.equal(a.postedAtSource, "divar-absolute");
  assert.equal(a.assessment.status, "unreviewed");
  raw.sections[0].widgets[0].data.description = "";
  assert.equal(parseDetail(raw, "test1234", now), null);
});
test("provider coalesces and caches queries, partial source is explicit", async () => {
  let calls = 0;
  const source = {
    multiCity: { selectedCities: [{ slug: "tehran", id: 1 }] },
    nb: {
      listWidgets: [{ data: { dto: { data: { token: "test1234" } } } }],
      pagination: { hasMore: true, data: { page: 1 } },
    },
  };
  const provider = new PublicDivarProvider({
    now: () => now,
    minIntervalMs: 0,
    maxDetails: 1,
    fetchImpl: async (u) => {
      calls++;
      return new Response(
        u.includes("posts-v2")
          ? JSON.stringify(rawDetail())
          : "<script>window.__PRELOADED_STATE__ = " +
            JSON.stringify(source) +
            "</script>",
      );
    },
  });
  const [a, b] = await Promise.all([provider.search({}), provider.search({})]);
  assert.equal(calls, 2);
  assert.equal(a.ads.length, 1);
  assert.equal(a.coverage, "partial-source");
  assert.deepEqual(a, b);
  assert((await provider.search({})).cached);
  assert.equal(calls, 2);
});
test("429 backs off and malformed source never claims complete", async () => {
  const provider = new PublicDivarProvider({
    now: () => now,
    minIntervalMs: 0,
    fetchImpl: async () =>
      new Response("", { status: 429, headers: { "retry-after": "120" } }),
  });
  const r = await provider.search({});
  assert.equal(r.coverage, "source-unavailable");
  assert.equal(provider.next, now + 120000);
});
test("render escapes seller HTML, has all images and fixed Persian time", () => {
  const r = renderListing(
    listing("test1234", {
      title: "<script>x</script>",
      desc: "<img src=x onerror=x>",
      url: "https://divar.ir/v/_/test1234",
    }),
  );
  assert(r.rich.includes("&lt;script&gt;"));
  assert(!r.rich.includes("<script>"));
  assert(!r.rich.includes("<tg-time"));
  assert(r.text.includes("۱۴۰۵"));
  assert.equal(r.photos.length, 1);
});
test("HTTP authenticates signed actor, blocks replay/body impersonation and restricts tenant", async () => {
  const secret = "x".repeat(32),
    db = store(),
    app = createApp({
      store: db,
      bridgeSecret: secret,
      provider: { search: async () => result([]) },
    });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const send = async (
    actor,
    route,
    payload = {},
    nonce = crypto.randomUUID(),
  ) => {
    const body = JSON.stringify(payload),
      url = "/api/" + route,
      timestamp = String(Date.now());
    const headers = {
      "Content-Type": "application/json",
      "x-aira-actor": actor,
      "x-aira-timestamp": timestamp,
      "x-aira-nonce": nonce,
      "x-aira-signature": signature(secret, {
        timestamp,
        nonce,
        actor,
        method: "POST",
        url,
        body,
      }),
    };
    return fetch(base + url, { method: "POST", headers, body });
  };
  try {
    assert.equal(
      (await fetch(base + "/api/meta", { method: "POST", body: "{}" })).status,
      401,
    );
    const nonce = crypto.randomUUID();
    assert.equal((await send("a", "meta", {}, nonce)).status, 200);
    assert.equal((await send("a", "meta", {}, nonce)).status, 400);
    assert.equal(
      (await send("a", "watch/create", { actor: "b", name: "x", spec: {} }))
        .status,
      400,
    );
    assert.equal(
      (await send("a", "watch/create", { name: "x", spec: {} })).status,
      201,
    );
    assert.equal(
      (await (await send("b", "watch/list")).json()).watches.length,
      0,
    );
    assert.equal(
      (await send("a", "search", { spec: { city: "../oops" } })).status,
      400,
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    db.close();
  }
});

test("category filtering includes descendants, rejects unknown/wrong category", () => {
  assert(matches(listing(), spec({ category: "electronic-devices" }), now));
  assert(!matches(listing(), spec({ category: "real-estate" }), now));
  assert(
    !matches(
      listing("test1234", { category: null }),
      spec({ category: "mobile-phones" }),
      now,
    ),
  );
});

test("create request idempotency survives retries and rejects changed payload", () => {
  const db = store();
  try {
    const input = { name: "one", search: {}, requestId: "request-1234" };
    const a = db.create("actor", input);
    assert.equal(db.create("actor", input).id, a.id);
    assert.equal(db.list("actor").length, 1);
    assert.throws(
      () => db.create("actor", { ...input, name: "different" }),
      /idempotency_conflict/,
    );
    assert.notEqual(db.create("other", input).id, a.id);
  } finally {
    db.close();
  }
});

test("deleting one overlapping watch retains receipts and pending delivery for the other", () => {
  const db = store();
  try {
    const a = db.create("actor", {
        name: "one",
        search: {},
        notifyExisting: true,
      }),
      b = db.create("actor", { name: "two", search: {}, notifyExisting: true });
    db.ingest(db.read("actor", a.id), result([listing()]));
    db.remove("actor", a.id);
    assert.throws(() => db.read("actor", a.id), /not_found/);
    const [e] = db.claim();
    assert(e);
    db.acknowledge(e.id, e.claimToken, { state: "sent", receipt: "message-1" });
    db.remove("actor", b.id);
    const c = db.create("actor", {
      name: "three",
      search: {},
      notifyExisting: true,
    });
    db.ingest(db.read("actor", c.id), result([listing()]));
    assert.equal(db.claim().length, 0);
    db.ingest(
      db.read("actor", c.id),
      result([listing("test1234", { fingerprint: "f2", price: 19e6 })]),
    );
    assert.equal(db.claim()[0].previousReceipt, "message-1");
  } finally {
    db.close();
  }
});

test("price reverting to a previously sent value still produces an edit", () => {
  const db = store();
  try {
    const w = db.create("a", { name: "x", search: {}, notifyExisting: true });
    for (const fingerprint of ["f1", "f2", "f1"]) {
      db.ingest(
        db.read("a", w.id),
        result([listing("test1234", { fingerprint })]),
      );
      const [e] = db.claim();
      assert(e);
      db.acknowledge(e.id, e.claimToken, {
        state: "sent",
        receipt: "receipt-" + fingerprint,
      });
    }
    assert.equal(db.events("a").filter((e) => e.state === "sent").length, 3);
  } finally {
    db.close();
  }
});

test("SQLite reopen keeps receipts; two connections cannot claim the same event", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "divar-test-")),
    file = path.join(dir, "db.sqlite");
  let a = new WatchStore(file, { now: () => now }),
    b;
  try {
    const w = a.create("a", { name: "x", search: {}, notifyExisting: true });
    a.ingest(a.read("a", w.id), result([listing()]));
    b = new WatchStore(file, { now: () => now });
    const [e] = a.claim();
    assert.equal(b.claim().length, 0);
    b.close();
    b = null;
    a.acknowledge(e.id, e.claimToken, {
      state: "sent",
      receipt: "persistent-1",
    });
    a.close();
    a = new WatchStore(file, { now: () => now });
    a.ingest(a.read("a", w.id), result([listing()]));
    assert.equal(a.claim().length, 0);
    assert.equal(a.events("a")[0].state, "sent");
  } finally {
    b?.close();
    a.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown sends retain reconciliation token; retry requires positive unsent evidence", () => {
  const db = store();
  try {
    const w = db.create("a", { name: "x", search: {}, notifyExisting: true });
    db.ingest(db.read("a", w.id), result([listing()]));
    const [e] = db.claim();
    db.acknowledge(e.id, e.claimToken, { state: "unknown" });
    assert.throws(
      () => db.acknowledge(e.id, e.claimToken, { state: "retry" }),
      /unsent_proof_required/,
    );
    db.acknowledge(e.id, e.claimToken, {
      state: "sent",
      receipt: "found-on-reconcile",
    });
    assert.equal(db.events("a")[0].state, "sent");
  } finally {
    db.close();
  }
});

test("client-only SSR fallback resolves city and carries query/category into public API", async () => {
  const calls = [];
  const city = {
    multiCity: { selectedCities: [{ slug: "tehran", id: 1 }] },
    nb: { listWidgets: [] },
    search: { searchData: { serverPayload: {} } },
  };
  const provider = new PublicDivarProvider({
    now: () => now,
    minIntervalMs: 0,
    maxDetails: 1,
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      if (url.includes("postlist"))
        return Response.json({
          list_widgets: [{ data: { token: "test1234" } }],
          pagination: { has_next_page: true, data: { page: 1 } },
        });
      if (url.includes("posts-v2")) return Response.json(rawDetail());
      return new Response(
        "<script>window.__PRELOADED_STATE__ = " +
          JSON.stringify(
            url.endsWith("/tehran")
              ? city
              : { nb: { listWidgets: [] }, multiCity: { selectedCities: [] } },
          ) +
          "</script>",
      );
    },
  });
  const r = await provider.search({
    query: "سامسونگ",
    category: "mobile-phones",
  });
  assert.equal(r.ads.length, 1);
  const payload = JSON.parse(
    calls.find((c) => c.url.includes("postlist")).opts.body,
  );
  assert.equal(payload.search_data.query, "سامسونگ");
  assert.equal(
    payload.search_data.form_data.data.category.str.value,
    "mobile-phones",
  );
  assert.deepEqual(payload.city_ids, ["1"]);
});

test("Python AIRA bridge interoperates with Node HMAC and actor scoped watch APIs", async () => {
  const db = store(),
    secret = "interop-test-only-".repeat(3),
    app = createApp({ store: db, bridgeSecret: secret });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  try {
    const base = "http://127.0.0.1:" + app.server.address().port;
    const script = `import sys,json;sys.path.insert(0,'services/divar-search');from aira_client import DivarClient;c=DivarClient(sys.argv[1],sys.argv[2].encode());a=c.call('verified-user','watch/create',{'name':'موبایل من','spec':{},'requestId':'interop-request'});b=c.call('verified-user','watch/list',{});other=c.call('other-user','watch/list',{});print(json.dumps({'id':a['id'],'name':b['watches'][0]['name'],'other':len(other['watches'])}))`;
    const { stdout } = await promisify(execFile)(
      process.platform === "win32" ? "py" : "python3",
      [
        ...(process.platform === "win32" ? ["-3.11"] : []),
        "-c",
        script,
        base,
        secret,
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      },
    );
    const r = JSON.parse(stdout);
    assert.equal(r.name, "موبایل من");
    assert.equal(r.other, 0);
  } finally {
    await new Promise((r) => app.server.close(r));
    db.close();
  }
});

test("car group attributes and base price are parsed; seller scores stay separate", () => {
  const raw = rawDetail();
  raw.seo.post_seo_schema.category = "light";
  raw.sections.find((s) => s.section_name === "LIST_DATA").widgets = [
    {
      widget_type: "GROUP_INFO_ROW",
      data: { items: [{ title: "کارکرد", value: "۳۷۰۰۰۰" }] },
    },
    {
      widget_type: "UNEXPANDABLE_ROW",
      data: { title: "قیمت پایه", value: "۹۶۰,۰۰۰,۰۰۰ تومان" },
    },
    {
      widget_type: "SCORE_ROW",
      data: { title: "موتور", descriptive_score: "سالم" },
    },
  ];
  const ad = parseDetail(raw, "test1234", now);
  assert.equal(ad.price, 960e6);
  assert.equal(ad.priceLabel, "قیمت پایه");
  assert.equal(ad.fields["کارکرد"], "۳۷۰۰۰۰");
  assert.equal(ad.fields["موتور"], undefined);
  assert.equal(ad.sellerAssessments["موتور"], "سالم");
  assert.equal(ad.assessment.status, "unreviewed");
});

test("grouped money and laptop category parse; rental and multi-city ambiguity remain explicit", () => {
  assert.equal(
    parseIntent("لپتاپ تا ۲۰,۰۰۰,۰۰۰ تومان تهران").spec.maxPrice,
    20e6,
  );
  assert.equal(parseIntent("لپتاپ تهران").spec.category, "laptops");
  const rent = parseIntent(
    "اجاره آپارتمان تهران رهن تا ۵۰۰ میلیون و اجاره ۱۰ میلیون",
  );
  assert.equal(rent.spec.maxPrice, null);
  assert(rent.questions.some((q) => q.includes("ودیعه")));
  assert(
    parseIntent("گوشی تهران یا شیراز").questions.some((q) =>
      q.includes("بیش از یک شهر"),
    ),
  );
});

test("new positive detail cancels unsent outdated price even outside the filter; stale detail cannot cancel it", () => {
  const db = store();
  try {
    const w = db.create("a", {
      name: "x",
      search: { maxPrice: 25e6 },
      notifyExisting: true,
    });
    const ad = listing("test1234", { verifiedAt: now });
    db.ingest(db.read("a", w.id), result([ad]));
    db.ingest(db.read("a", w.id), {
      ...result([]),
      observed: [
        listing("test1234", {
          fingerprint: "old",
          price: 40e6,
          verifiedAt: now - 1,
        }),
      ],
    });
    assert.equal(db.events("a")[0].state, "pending");
    db.ingest(db.read("a", w.id), {
      ...result([]),
      observed: [
        listing("test1234", {
          fingerprint: "changed",
          price: 40e6,
          verifiedAt: now + 1,
        }),
      ],
    });
    assert.equal(db.claim().length, 0);
    assert.equal(db.events("a")[0].state, "cancelled");
  } finally {
    db.close();
  }
});

test("rate-limited provider fails fast for different specs until cooldown passes", async () => {
  let calls = 0;
  const p = new PublicDivarProvider({
    now: () => now,
    minIntervalMs: 0,
    fetchImpl: async () => {
      calls++;
      return new Response("", { status: 429 });
    },
  });
  await p.search({ query: "first" });
  const r = await p.search({ query: "second" });
  assert.equal(calls, 1);
  assert.equal(r.errors[0].code, "source_rate_limited");
});

test("delivery rechecks a batch lease before sending the next item", async () => {
  const db = store();
  try {
    const w = db.create("a", { name: "x", search: {}, notifyExisting: true });
    db.ingest(
      db.read("a", w.id),
      result([listing("first123"), listing("second12")]),
    );
    let calls = 0;
    const receipts = await deliverPending(db, {
      send: async () => {
        calls++;
        now += 130000;
        return { id: "receipt-one" };
      },
    });
    assert.equal(calls, 1);
    assert.equal(receipts[1].state, "not-sent");
    assert.equal(db.events("a").filter((e) => e.state === "unknown").length, 1);
  } finally {
    db.close();
  }
});
