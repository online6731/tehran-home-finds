import { specKey } from "./contracts.mjs";
export class WatchWorker {
  constructor(store, provider) {
    this.store = store;
    this.provider = provider;
    this.running = false;
  }
  async tick() {
    if (this.running) return { skipped: "already_running" };
    this.running = true;
    let queued = 0;
    const groups = new Map(),
      failures = [];
    try {
      for (const w of this.store.runnable()) {
        const s = JSON.parse(w.spec),
          key = specKey(s);
        if (!groups.has(key)) groups.set(key, { spec: s, watches: [] });
        groups.get(key).watches.push(w);
      }
      for (const { spec, watches } of groups.values()) {
        let result;
        try {
          result = await this.provider.search(spec);
        } catch {
          result = {
            ads: [],
            coverage: "source-unavailable",
            errors: [{ code: "provider_failed" }],
          };
        }
        if (result.errors?.length)
          failures.push({ watchCount: watches.length, errors: result.errors });
        for (const w of watches) queued += this.store.ingest(w, result).queued;
      }
      return { searches: groups.size, queued, failures };
    } finally {
      this.running = false;
    }
  }
}
export async function deliverPending(store, transport, { limit = 10 } = {}) {
  const receipts = [];
  for (const e of store.claim(limit)) {
    if (!store.readyToSend(e.id, e.claimToken)) {
      receipts.push({ id: e.id, state: "not-sent" });
      continue;
    }
    // transport resolves actor through AIRA's verified owner binding; payloads
    // never provide chat IDs. Receipt must persist before a send is confirmed.
    try {
      const receipt = await transport.send(e);
      store.acknowledge(e.id, e.claimToken, {
        state: "sent",
        receipt: receipt.id,
      });
      receipts.push({ id: e.id, state: "sent" });
    } catch (error) {
      const state = error.requestNotSent === true ? "retry" : "unknown";
      store.acknowledge(e.id, e.claimToken, {
        state,
        requestNotSent: error.requestNotSent === true,
      });
      receipts.push({ id: e.id, state });
    }
  }
  return receipts;
}
