import { extractState, publishedAtInfo } from "../../src/divar.mjs";
import { sourceMapPoint, aerialDistance } from "../../src/locations.mjs";
import { spec, specKey, matches, fingerprint } from "./contracts.mjs";
import fs from "node:fs";
const verifiedCities = JSON.parse(
  fs.readFileSync(new URL("../../data/divar-cities.json", import.meta.url)),
);
const widgets = (raw, name) =>
  (raw.sections?.find((s) => s.section_name === name)?.widgets || []).map(
    (w) => ({ dto: { widget_type: w.widget_type, data: w.data } }),
  );
export function parseDetail(raw, id, now = Date.now()) {
  if (!Array.isArray(raw.sections) || !raw.seo?.web_info?.title || !raw.city)
    throw Error("source_detail_schema");
  const fields = {},
    sellerAssessments = {};
  function read(ws) {
    for (const w of ws || []) {
      const d = w.dto?.data || w.data || w;
      if (!d) continue;
      if (typeof d.title === "string" && typeof d.value === "string")
        fields[d.title] = d.value;
      if (
        typeof d.title === "string" &&
        typeof d.descriptive_score === "string"
      )
        sellerAssessments[d.title] = d.descriptive_score;
      read(d.items);
      read(d.widget_list);
      read(d.action?.payload?.modal_page?.widget_list);
    }
  }
  read(widgets(raw, "LIST_DATA"));
  const posting = publishedAtInfo(widgets(raw, "TITLE"), now);
  // Relative timestamps cannot safely drive new-ad alerts.
  if (!posting || posting.postedAtSource !== "divar-absolute") return null;
  const pics = [
    ...new Set(
      widgets(raw, "IMAGE")
        .flatMap((w) =>
          (w.dto.data.items || []).map((i) => i.image?.url || i.image_url),
        )
        .filter((u) => /^https:\/\/[a-z0-9.-]+\.divarcdn\.com\//.test(u)),
    ),
  ];
  const priceLabel =
    ["قیمت", "قیمت پایه", "قیمت کل"].find((k) => fields[k]) || null;
  const priceText = fields[priceLabel];
  const digits = String(priceText || "")
    .replace(/[۰-۹]/g, (c) => "۰۱۲۳۴۵۶۷۸۹".indexOf(c))
    .replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c));
  const price =
    /\d/.test(digits) && /تومان|ریال/.test(digits)
      ? Number(digits.replace(/[^0-9]/g, "")) / (/ریال/.test(digits) ? 10 : 1)
      : null;
  const location = sourceMapPoint({ MAP: widgets(raw, "MAP") });
  const ad = {
    id,
    url: "https://divar.ir/v/_/" + id,
    title: raw.seo.web_info.title,
    category:
      raw.seo.post_seo_schema?.category || raw.webengage?.category || null,
    categoryName: raw.seo.web_info.category_slug_persian || null,
    citySlug: raw.city.second_slug || raw.city.slug,
    cityId: String(raw.city.city_id),
    area: raw.seo.web_info.district_persian || "",
    desc: widgets(raw, "DESCRIPTION")
      .filter((w) => w.dto.widget_type === "DESCRIPTION_ROW")
      .map((w) => w.dto.data.text || "")
      .join("\n"),
    price,
    priceText: priceText || null,
    fields,
    condition: fields["وضعیت"] || null,
    pics,
    ...posting,
    verifiedAt: now,
    assessment: {
      status: "unreviewed",
      note: "عکس‌ها ارزیابی نشده‌اند؛ سلامت فنی تأیید نشده است.",
    },
    locationPoint: location,
    distanceKm:
      location && raw.city.second_slug === "tehran"
        ? aerialDistance(location.lat, location.lon)
        : null,
    distanceReference:
      location && raw.city.second_slug === "tehran"
        ? "فاصلهٔ هوایی نقطهٔ نقشهٔ دیوار تا هفت‌تیر"
        : null,
  };
  ad.priceLabel = priceLabel;
  ad.sellerAssessments = sellerAssessments;
  ad.videos = widgets(raw, "IMAGE")
    .flatMap((w) => (w.dto.data.items || []).map((i) => i.video_url))
    .filter((u) => /^https:\/\/[a-z0-9.-]+\.divarcdn\.com\//.test(u || ""));
  ad.fingerprint = fingerprint([
    ad.title,
    ad.desc,
    ad.price,
    ad.fields,
    ad.sellerAssessments,
    ad.pics,
    ad.videos,
    ad.postedAt,
    ad.citySlug,
    ad.area,
    ad.category,
    ad.locationPoint,
  ]);
  return ad;
}
export class PublicDivarProvider {
  constructor({
    fetchImpl = fetch,
    now = Date.now,
    minIntervalMs = 2000,
    timeoutMs = 20000,
    cacheMs = 60000,
    maxDetails = 24,
    maxPages = 2,
  } = {}) {
    Object.assign(this, {
      fetchImpl,
      now,
      minIntervalMs,
      timeoutMs,
      cacheMs,
      maxDetails,
      maxPages,
    });
    this.cache = new Map();
    this.inflight = new Map();
    this.details = new Map();
    this.tail = Promise.resolve();
    this.next = 0;
    this.cooldownUntil = 0;
    this.cityIds = new Map(verifiedCities.cities.map((c) => [c.slug, c.id]));
  }
  async request(url, options = {}) {
    const work = this.tail.then(async () => {
      if (this.cooldownUntil > this.now()) throw Error("source_rate_limited");
      const wait = this.next - this.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.next = this.now() + this.minIntervalMs;
      const r = await this.fetchImpl(url, {
        ...options,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json-filled",
          ...options.headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (r.status === 429) {
        const retry = r.headers.get("retry-after");
        const ms = /^\d+$/.test(retry || "")
          ? Number(retry) * 1000
          : Date.parse(retry) - this.now();
        this.next = this.now() + Math.min(3600000, Math.max(60000, ms || 0));
        this.cooldownUntil = this.next;
        throw Error("source_rate_limited");
      }
      if (!r.ok) throw Error("source_http_" + r.status);
      return r.text();
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async search(input) {
    const s = spec(input),
      key = specKey(s),
      cached = this.cache.get(key);
    if (cached && cached.until > this.now())
      return { ...cached.result, cached: true };
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = this.collect(s)
      .then((result) => {
        this.cache.set(key, { until: this.now() + this.cacheMs, result });
        while (this.cache.size > 200)
          this.cache.delete(this.cache.keys().next().value);
        return result;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
  async collect(s) {
    const startedAt = this.now(),
      url = new URL(
        "https://divar.ir/s/" +
          s.city +
          (s.category === "ROOT" ? "" : "/" + s.category),
      );
    if (s.query) url.searchParams.set("q", s.query);
    if (s.minPrice !== null || s.maxPrice !== null)
      url.searchParams.set(
        "price",
        (s.minPrice ?? "") + "-" + (s.maxPrice ?? ""),
      );
    const ads = [],
      observed = [],
      errors = [],
      seen = new Set();
    let pages = 0,
      scanned = 0,
      hasMore = true,
      cityId = null,
      cursor = null,
      formData = null,
      serverPayload = null;
    try {
      let state;
      try {
        state = extractState(
          await this.request(url.href, { headers: { Accept: "text/html" } }),
        );
      } catch (e) {
        if (e.message === "source_rate_limited") throw e;
      }
      let fromApi = false;
      // Category pages intermittently return a client-only shell or HTTP 404.
      // Resolve the city from its base page, then use the same public list API.
      if (
        !Array.isArray(state?.nb?.listWidgets) ||
        !state.multiCity?.selectedCities?.some((c) => c.slug === s.city)
      ) {
        try {
          state = extractState(
            await this.request("https://divar.ir/s/" + s.city, {
              headers: { Accept: "text/html" },
            }),
          );
        } catch (e) {
          if (e.message === "source_rate_limited") throw e;
          state = {};
        }
        fromApi = true;
      }
      const resolved = state.multiCity?.selectedCities?.find(
        (c) => c.slug === s.city,
      );
      cityId = resolved ? String(resolved.id) : this.cityIds.get(s.city);
      if (!cityId) throw Error("source_city_unresolved");
      if (resolved) this.cityIds.set(s.city, cityId);
      const info = state.nb?.listWidgets?.find(
        (w) => w.actionLog?.server_side_info?.info?.search_data,
      )?.actionLog.server_side_info.info.search_data;
      formData = info?.form_data_json
        ? JSON.parse(info.form_data_json)
        : { data: { category: { str: { value: s.category } } } };
      serverPayload = info?.server_payload_json
        ? JSON.parse(info.server_payload_json)
        : undefined;
      const list = async (pagination) => {
        const raw = JSON.parse(
          await this.request("https://api.divar.ir/v8/postlist/w/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "X-Render-Type": "CSR",
            },
            body: JSON.stringify({
              source_view: "",
              search_data: {
                form_data: formData,
                server_payload: serverPayload,
                query: s.query,
              },
              city_ids: [cityId],
              ...(pagination ? { pagination_data: pagination } : {}),
            }),
          }),
        );
        if (!Array.isArray(raw.list_widgets))
          throw Error("source_pagination_schema");
        hasMore = raw.pagination?.has_next_page === true;
        cursor = raw.pagination?.data;
        return raw.list_widgets
          .map((w) => w.data || w.dto?.data)
          .filter((d) => d?.token);
      };
      let rows;
      if (fromApi) {
        formData = { data: { category: { str: { value: s.category } } } };
        if (s.minPrice !== null || s.maxPrice !== null) {
          const range = {
            ...(s.minPrice !== null ? { minimum: String(s.minPrice) } : {}),
            ...(s.maxPrice !== null ? { maximum: String(s.maxPrice) } : {}),
          };
          formData.data.price = { number_range: { ...range, value: range } };
        }
        serverPayload = state.search?.searchData?.serverPayload || {
          "@type": "type.googleapis.com/widgets.SearchData.ServerPayload",
          additional_form_data: {
            data: { sort: { str: { value: "sort_date" } } },
          },
        };
        rows = await list();
      } else {
        rows = state.nb.listWidgets
          .map((w) => w.data?.dto?.data)
          .filter((d) => d?.token);
        cursor = state.nb.pagination?.data;
        hasMore = state.nb.pagination?.hasMore === true;
      }
      while (true) {
        pages++;
        for (const row of rows) {
          if (seen.has(row.token)) continue;
          if (!/^[\w-]{4,64}$/.test(row.token))
            throw Error("source_invalid_id");
          if (scanned >= this.maxDetails) break;
          seen.add(row.token);
          scanned++;
          const cached = this.details.get(row.token);
          let ad;
          try {
            if (cached && cached.until > this.now()) ad = cached.ad;
            else {
              ad = parseDetail(
                JSON.parse(
                  await this.request(
                    "https://api.divar.ir/v8/posts-v2/web/" + row.token,
                  ),
                ),
                row.token,
                this.now(),
              );
              this.details.set(row.token, {
                until: this.now() + this.cacheMs,
                ad,
              });
              while (this.details.size > 1000)
                this.details.delete(this.details.keys().next().value);
            }
            if (ad) observed.push(ad);
            else
              errors.push({
                id: row.token,
                code: "source_absolute_time_missing",
              });
            if (ad && matches(ad, s, this.now())) ads.push(ad);
          } catch (e) {
            errors.push({ id: row.token, code: e.message });
            if (/rate_limited/.test(e.message)) break;
          }
        }
        if (
          errors.length ||
          scanned >= this.maxDetails ||
          !hasMore ||
          pages >= this.maxPages
        )
          break;
        if (!cursor) {
          errors.push({ code: "source_cursor_missing" });
          break;
        }
        rows = await list(cursor);
      }
    } catch (e) {
      errors.push({ code: e.message });
    }
    const complete = !hasMore && !errors.length && scanned < this.maxDetails;
    return {
      ads,
      observed,
      coverage: complete
        ? "complete-source-window"
        : ads.length || pages
          ? "partial-source"
          : "source-unavailable",
      hasMore: !complete,
      errors,
      pages,
      scanned,
      startedAt,
      checkedAt: this.now(),
      sourceUrl: url.href,
      cached: false,
      limits: { maxDetails: this.maxDetails, maxPages: this.maxPages },
      notice:
        "جست‌وجوی عمومی دیوار؛ پوشش به محدودیت منبع و تعداد صفحات وابسته است. عکس‌ها بررسی نشده‌اند.",
    };
  }
}
