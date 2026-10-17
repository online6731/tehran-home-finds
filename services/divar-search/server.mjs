import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import {
  taxonomy,
  cities,
  parseIntent,
  spec,
  object,
  check,
  text,
} from "./contracts.mjs";
import { PublicDivarProvider } from "./provider.mjs";
import { WatchStore } from "./store.mjs";
import { WatchWorker } from "./worker.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
export function signature(
  secret,
  { timestamp, nonce, actor, method, url, body },
) {
  return createHmac("sha256", secret)
    .update([timestamp, nonce, actor, method, url, body].join("\n"))
    .digest("hex");
}
export function createApp({
  store = new WatchStore(),
  provider = new PublicDivarProvider(),
  dev = false,
  bridgeSecret = null,
  authenticate = null,
  now = Date.now,
} = {}) {
  if (bridgeSecret && Buffer.byteLength(bridgeSecret) < 32)
    throw Error("bridge_key_too_short");
  const sessions = new Map(),
    replays = new Map(),
    rates = new Map(),
    worker = new WatchWorker(store, provider);
  let searching = 0;
  const json = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' https://*.divarcdn.com; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const host = req.headers.host;
      check(
        typeof host === "string" &&
          /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host),
        "invalid_host",
      );
      const url = new URL(req.url, "http://" + host);
      if (
        req.method === "GET" &&
        ["/", "/app.mjs", "/style.css"].includes(url.pathname)
      ) {
        const name =
          url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        res.writeHead(200, {
          "Content-Type": name.endsWith(".mjs")
            ? "text/javascript; charset=utf-8"
            : name.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/html; charset=utf-8",
        });
        res.end(fs.readFileSync(path.join(here, "web", name)));
        return;
      }
      if (req.method === "GET" && url.pathname === "/healthz")
        return json(res, 200, {
          status: "ok",
          version: 1,
          delivery: "adapter-required",
          authentication: dev ? "local-preview" : "signed-bridge",
        });
      check(req.method === "POST", "method_not_allowed");
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        check(Buffer.byteLength(raw) <= 65536, "body_too_large");
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw Object.assign(Error("invalid_json"), { status: 400 });
      }
      const origin = req.headers.origin;
      if (origin) check(origin === "http://" + host, "origin_denied");
      let actor = null;
      if (req.headers["x-aira-signature"] && bridgeSecret) {
        const timestamp = String(req.headers["x-aira-timestamp"] || ""),
          nonce = String(req.headers["x-aira-nonce"] || ""),
          principal = String(req.headers["x-aira-actor"] || ""),
          given = String(req.headers["x-aira-signature"]);
        check(
          /^\d+$/.test(timestamp) &&
            Math.abs(now() - Number(timestamp)) <= 60000 &&
            /^[\w-]{16,100}$/.test(nonce) &&
            principal.length > 0 &&
            principal.length <= 150,
          "signature_expired",
        );
        const wanted = signature(bridgeSecret, {
          timestamp,
          nonce,
          actor: principal,
          method: req.method,
          url: req.url,
          body: raw,
        });
        check(
          /^[a-f0-9]{64}$/.test(given) &&
            timingSafeEqual(
              Buffer.from(wanted, "hex"),
              Buffer.from(given, "hex"),
            ),
          "signature_invalid",
        );
        for (const [key, until] of replays)
          if (until < now()) replays.delete(key);
        check(!replays.has(nonce), "signature_replayed");
        check(replays.size < 10000, "bridge_busy");
        replays.set(nonce, now() + 120000);
        actor = principal;
      } else if (authenticate) {
        actor = await authenticate(req);
        check(
          typeof actor === "string" && actor.length > 0 && actor.length <= 150,
          "authentication_required",
        );
      } else if (dev) {
        check(origin === "http://" + host, "origin_required");
        check(
          !req.headers["sec-fetch-site"] ||
            req.headers["sec-fetch-site"] === "same-origin",
          "origin_denied",
        );
        const cookie = String(req.headers.cookie || "").match(
          /(?:^|; )divar_preview=([a-f0-9]{48})(?:;|$)/,
        )?.[1];
        if (cookie && sessions.get(cookie)?.until > now())
          actor = sessions.get(cookie).actor;
        else {
          for (const [id, v] of sessions)
            if (v.until < now()) sessions.delete(id);
          check(sessions.size < 1000, "session_limit");
          const token = randomBytes(24).toString("hex");
          actor = "preview:" + randomBytes(16).toString("hex");
          sessions.set(token, { actor, until: now() + 86400000 });
          res.setHeader(
            "Set-Cookie",
            `divar_preview=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
          );
        }
      } else
        throw Object.assign(Error("authentication_required"), { status: 401 });
      for (const [key, r] of rates) if (r.until < now()) rates.delete(key);
      const rate = rates.get(actor) || { count: 0, until: now() + 60000 };
      rate.count++;
      rates.set(actor, rate);
      if (rate.count > 60)
        throw Object.assign(Error("rate_limit"), { status: 429 });
      if (url.pathname === "/api/meta") {
        object(data, []);
        return json(res, 200, {
          categories: taxonomy.categories,
          cities,
          mode: dev ? "local-preview" : "authenticated",
          notifications: "prepared-outbox",
          allCategories: true,
        });
      }
      if (url.pathname === "/api/intent") {
        object(data, ["text"]);
        return json(res, 200, parseIntent(data.text));
      }
      if (url.pathname === "/api/search") {
        object(data, ["spec"]);
        const s = spec(data.spec);
        if (searching >= 4)
          throw Object.assign(Error("search_busy"), { status: 429 });
        searching++;
        try {
          const { observed, ...publicResult } = await provider.search(s);
          return json(res, 200, publicResult);
        } finally {
          searching--;
        }
      }
      if (url.pathname === "/api/watch/list") {
        object(data, []);
        return json(res, 200, { watches: store.list(actor) });
      }
      if (url.pathname === "/api/watch/create") {
        object(data, ["name", "spec", "notifyExisting", "requestId"]);
        return json(
          res,
          201,
          store.create(actor, {
            name: data.name,
            search: data.spec,
            notifyExisting: data.notifyExisting ?? false,
            requestId: data.requestId ?? null,
          }),
        );
      }
      if (url.pathname === "/api/watch/update") {
        object(data, ["id", "version", "name", "spec", "enabled"]);
        text(data.id, 100);
        return json(
          res,
          200,
          store.update(actor, data.id, {
            version: data.version,
            name: data.name,
            search: data.spec,
            enabled: data.enabled,
          }),
        );
      }
      if (url.pathname === "/api/watch/delete") {
        object(data, ["id"]);
        text(data.id, 100);
        store.remove(actor, data.id);
        return json(res, 200, { deleted: true });
      }
      if (url.pathname === "/api/notifications") {
        object(data, []);
        return json(res, 200, { events: store.events(actor) });
      }
      if (url.pathname === "/api/favorites") {
        object(data, []);
        return json(res, 200, { ads: store.favorites(actor) });
      }
      if (url.pathname === "/api/favorite") {
        object(data, ["listing", "enabled"]);
        check(
          data.listing &&
            Buffer.byteLength(JSON.stringify(data.listing)) < 40000,
        );
        store.favorite(actor, data.listing, data.enabled);
        return json(res, 200, { saved: true });
      }
      return json(res, 404, { error: "not_found" });
    } catch (e) {
      const status = e.status || 500;
      json(res, status, {
        error: status === 500 ? "internal_error" : e.message,
      });
    }
  });
  return { server, store, worker };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dev = process.argv.includes("--dev"),
    database =
      process.env.DIVAR_DB ||
      path.join(here, "private-data", "watchlists.sqlite");
  fs.mkdirSync(path.dirname(database), { recursive: true });
  const key = process.env.DIVAR_BRIDGE_KEY_FILE
    ? fs.readFileSync(process.env.DIVAR_BRIDGE_KEY_FILE, "utf8").trim()
    : null;
  if (!dev && !key)
    throw Error("Set DIVAR_BRIDGE_KEY_FILE or use --dev for local preview");
  const app = createApp({
      dev,
      bridgeSecret: key,
      store: new WatchStore(database),
    }),
    port = Number(process.env.PORT || 18473);
  app.server.listen(port, "127.0.0.1", () =>
    console.log(
      JSON.stringify({
        url: "http://127.0.0.1:" + port,
        mode: dev ? "local-preview" : "signed-bridge",
        delivery: "not-connected",
      }),
    ),
  );
  let timer;
  if (process.argv.includes("--poll")) {
    timer = setInterval(
      () =>
        app.worker
          .tick()
          .then((r) => console.log(JSON.stringify(r)))
          .catch(() => console.error("worker_failed")),
      300000,
    );
    timer.unref();
  }
  const stop = () => {
    clearInterval(timer);
    app.server.close(() => {
      app.store.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
