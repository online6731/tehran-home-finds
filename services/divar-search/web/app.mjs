const $ = (id) => document.getElementById(id),
  fa = (n) => new Intl.NumberFormat("fa-IR").format(n),
  node = (tag, text, className) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  };
let currentTab = "results",
  results = [],
  editingWatch = null,
  createRequestId = crypto.randomUUID();
function fieldRow(key = "", value = "") {
  const row = node("div", undefined, "fieldRow"),
    k = node("input"),
    v = node("input"),
    remove = node("button", "حذف", "secondary");
  k.placeholder = "نام ویژگی";
  k.setAttribute("aria-label", "نام ویژگی");
  v.placeholder = "مقدار دقیق";
  v.setAttribute("aria-label", "مقدار دقیق");
  k.value = key;
  v.value = value;
  remove.onclick = () => row.remove();
  row.append(k, v, remove);
  $("fieldRows").append(row);
}
$("addField").onclick = () => fieldRow();
async function api(path, data = {}) {
  const r = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await r.json();
  if (!r.ok) throw Error(body.error);
  return body;
}
const split = (id) =>
  $(id)
    .value.split(/[,،]/)
    .map((s) => s.trim())
    .filter(Boolean);
function read() {
  return {
    version: 1,
    query: $("query").value,
    city: $("city").value,
    category: $("category").value,
    minPrice: $("minPrice").value === "" ? null : Number($("minPrice").value),
    maxPrice: $("maxPrice").value === "" ? null : Number($("maxPrice").value),
    conditions: [...$("condition").selectedOptions].map((o) => o.value),
    areas: split("areas"),
    exclude: split("exclude"),
    maxAgeHours: Number($("age").value),
    requirePhotos: $("requirePhotos").checked,
    fields: Object.fromEntries(
      [...$("fieldRows").children]
        .map((r) => [r.children[0].value.trim(), r.children[1].value.trim()])
        .filter(([k]) => k),
    ),
  };
}
function fill(s) {
  $("query").value = s.query;
  $("city").value = s.city;
  $("category").value = s.category;
  $("minPrice").value = s.minPrice ?? "";
  $("maxPrice").value = s.maxPrice ?? "";
  for (const o of $("condition").options)
    o.selected = s.conditions.includes(o.value);
  $("areas").value = s.areas.join("، ");
  $("exclude").value = s.exclude.join("، ");
  $("age").value = s.maxAgeHours;
  $("requirePhotos").checked = s.requirePhotos;
  $("fieldRows").replaceChildren();
  for (const [k, v] of Object.entries(s.fields)) fieldRow(k, v);
}
function notice(t, error = false) {
  $("notice").textContent = t;
  $("notice").classList.toggle("error", error);
}
async function action(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (e) {
    notice(
      {
        search_busy: "جست‌وجو در حال انجام است؛ کمی بعد تلاش کنید.",
        source_rate_limited: "منبع موقتاً محدود شده است.",
        inverted_price_range: "حداقل قیمت نباید از حداکثر بیشتر باشد.",
        unknown_category: "دسته را انتخاب کنید.",
        version_conflict: "واچ‌لیست تغییر کرده؛ دوباره آن را باز کنید.",
      }[e.message] || "عملیات انجام نشد: " + e.message,
      true,
    );
  } finally {
    button.disabled = false;
  }
}
function sourceLink() {
  const s = read(),
    u = new URL(
      "https://divar.ir/s/" +
        s.city +
        (s.category === "ROOT" ? "" : "/" + s.category),
    );
  if (s.query) u.searchParams.set("q", s.query);
  if (s.minPrice !== null || s.maxPrice !== null)
    u.searchParams.set("price", (s.minPrice ?? "") + "-" + (s.maxPrice ?? ""));
  $("source").href = u.href;
}
function empty(text) {
  $("content").replaceChildren(node("div", text, "empty"));
}
function cards(ads) {
  $("content").replaceChildren();
  if (!ads.length)
    return empty("آگهی‌ای با این شرایط در محدودهٔ بررسی‌شده پیدا نشد.");
  for (const ad of ads) {
    const card = node("article", undefined, "card"),
      media = node("div", undefined, "media");
    let pos = 0;
    const img = node("img");
    img.alt = ad.title;
    img.loading = "lazy";
    const counter = node("span", undefined, "counter");
    function image() {
      const url = ad.pics[pos];
      if (/^https:\/\/[a-z0-9.-]+\.divarcdn\.com\//.test(url || ""))
        img.src = url;
      counter.textContent = fa(pos + 1) + " / " + fa(ad.pics.length);
    }
    if (ad.pics.length) {
      image();
      media.append(img, counter);
    } else media.append(node("span", "بدون عکس"));
    if (ad.pics.length > 1) {
      for (const [cls, step, label] of [
        ["prev", -1, "‹"],
        ["next", 1, "›"],
      ]) {
        const b = node("button", label, cls);
        b.setAttribute("aria-label", step < 0 ? "عکس قبلی" : "عکس بعدی");
        b.onclick = () => {
          pos = (pos + step + ad.pics.length) % ad.pics.length;
          image();
        };
        media.append(b);
      }
    }
    const body = node("div", undefined, "body");
    body.append(
      node("h3", ad.title),
      node(
        "div",
        Number.isFinite(ad.price)
          ? fa(ad.price) + " تومان"
          : ad.priceText || "قیمت اعلام نشده",
        "price",
      ),
      node("p", ad.area + " · " + ad.citySlug, "meta"),
    );
    body.append(
      node(
        "p",
        Number.isFinite(ad.postedAt)
          ? new Intl.DateTimeFormat("fa-IR", {
              timeZone: "Asia/Tehran",
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(ad.postedAt)
          : "زمان ثبت نامشخص",
        "meta",
      ),
      node("span", "عکس‌ها بررسی نشده‌اند", "unreviewed"),
    );
    const details = node("details"),
      summary = node("summary", "توضیحات و ویژگی‌های فروشنده");
    details.append(summary, node("p", ad.desc));
    for (const [k, v] of Object.entries(ad.fields || {}))
      details.append(node("p", k + " : " + v));
    for (const [k, v] of Object.entries(ad.sellerAssessments || {}))
      details.append(node("p", "ارزیابی فروشنده · " + k + " : " + v));
    body.append(details);
    const actions = node("div", undefined, "actions"),
      link = node("a", "دیدن در دیوار ↗");
    link.href = "https://divar.ir/v/_/" + encodeURIComponent(ad.id);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const favorite = node(
      "button",
      currentTab === "favorites" ? "حذف علاقه‌مندی" : "علاقه‌مندی",
      "secondary",
    );
    favorite.onclick = () =>
      action(favorite, async () => {
        await api("favorite", {
          listing: ad,
          enabled: currentTab !== "favorites",
        });
        notice("علاقه‌مندی به‌روز شد.");
        if (currentTab === "favorites") tab("favorites");
      });
    actions.append(link, favorite);
    body.append(actions);
    card.append(media, body);
    $("content").append(card);
  }
}
async function tab(name) {
  currentTab = name;
  for (const n of ["results", "watches", "favorites", "events"])
    $(n + "Tab").classList.toggle("active", n === name);
  if (name === "results") {
    cards(results);
    return;
  }
  if (name === "favorites") {
    cards((await api("favorites")).ads);
    return;
  }
  if (name === "events") {
    const e = (await api("notifications")).events;
    $("content").replaceChildren();
    if (!e.length)
      empty("هنوز اعلانی نیست. پایش و ارسال آیرا پس از اتصال فعال می‌شود.");
    for (const v of e)
      $("content").append(
        node(
          "div",
          v.payload.listing.title +
            " · " +
            ({
              pending: "در صف",
              sent: "ارسال شده",
              unknown: "نیازمند بررسی رسید",
              cancelled: "لغو شده",
              expired: "منقضی",
            }[v.state] || v.state),
          "card watch",
        ),
      );
    return;
  }
  const ws = (await api("watch/list")).watches;
  $("content").replaceChildren();
  if (!ws.length) empty("جست‌وجوی دلخواهتان را در واچ‌لیست ذخیره کنید.");
  for (const w of ws) {
    const c = node("article", undefined, "card watch");
    c.append(
      node("h3", w.name),
      node("p", `${w.spec.query || "همهٔ آگهی‌ها"} · ${w.spec.city}`, "meta"),
      node("p", w.enabled ? "پایش ذخیره شده" : "متوقف", "meta"),
      node(
        "p",
        w.status
          ? `آخرین بررسی: ${w.status.coverage}`
          : "اولین بررسی هنوز اجرا نشده",
        "meta",
      ),
    );
    const acts = node("div", undefined, "actions");
    const edit = node("button", "بارگذاری فیلتر", "secondary");
    edit.textContent = "ویرایش";
    edit.onclick = () => {
      editingWatch = w;
      fill(w.spec);
      $("watchName").value = w.name;
      $("save").textContent = "ذخیرهٔ تغییرات";
      $("notifyExisting").disabled = true;
      sourceLink();
      notice(
        "در حال ویرایش «" +
          w.name +
          "»؛ با ذخیره، همین واچ‌لیست به‌روز می‌شود.",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const toggle = node("button", w.enabled ? "توقف" : "ادامه", "secondary");
    toggle.onclick = () =>
      action(toggle, async () => {
        await api("watch/update", {
          id: w.id,
          version: w.version,
          enabled: !w.enabled,
        });
        await tab("watches");
      });
    const remove = node("button", "حذف", "secondary");
    remove.onclick = () =>
      action(remove, async () => {
        await api("watch/delete", { id: w.id });
        await tab("watches");
      });
    acts.append(edit, toggle, remove);
    c.append(acts);
    $("content").append(c);
  }
}
function resetEdit() {
  editingWatch = null;
  createRequestId = crypto.randomUUID();
  $("save").textContent = "ذخیره در واچ‌لیست";
  $("notifyExisting").disabled = false;
}
$("newWatch").onclick = () => {
  resetEdit();
  $("watchName").value = "";
  $("notifyExisting").checked = false;
  notice("آمادهٔ ساخت واچ‌لیست جدا با فیلترهای فعلی.");
};
$("understand").onclick = () =>
  action($("understand"), async () => {
    const r = await api("intent", { text: $("intent").value });
    fill(r.spec);
    $("interpretation").textContent = [...r.questions, ...r.warnings].join(" ");
    sourceLink();
    notice("برداشت اولیه آماده است؛ فیلترها را بازبینی کنید.");
  });
$("search").onclick = () =>
  action($("search"), async () => {
    sourceLink();
    notice(
      "در حال بررسی آگهی‌ها و دریافت گالری؛ ممکن است حدود یک دقیقه زمان ببرد…",
    );
    const r = await api("search", { spec: read() });
    results = r.ads;
    await tab("results");
    notice(
      `${fa(r.ads.length)} نتیجه · ${r.coverage === "complete-source-window" ? "صفحات منبع بررسی شد" : "پوشش محدود؛ همهٔ صفحات بررسی نشده"}${r.errors.length ? " · خطای دریافت بخشی از منبع" : ""} · عکس‌ها بررسی نشده‌اند`,
    );
  });
$("save").onclick = () =>
  action($("save"), async () => {
    const s = read(),
      name = $("watchName").value.trim() || s.query || "جست‌وجوی دیوار";
    if (editingWatch)
      await api("watch/update", {
        id: editingWatch.id,
        version: editingWatch.version,
        name,
        spec: s,
      });
    else
      await api("watch/create", {
        requestId: createRequestId,
        name,
        spec: s,
        notifyExisting: $("notifyExisting").checked,
      });
    resetEdit();
    notice("واچ‌لیست ذخیره شد؛ ارسال تلگرام هنوز متصل نیست.");
    await tab("watches");
  });
for (const n of ["results", "watches", "favorites", "events"])
  $(n + "Tab").onclick = () => action($(n + "Tab"), () => tab(n));
for (const id of ["query", "city", "category", "minPrice", "maxPrice"])
  $(id).addEventListener("change", sourceLink);
try {
  const m = await api("meta");
  for (const c of m.categories) {
    if (c.slug === "ROOT") continue;
    const option = node("option", c.path.slice(1).join(" / "));
    option.value = c.slug;
    $("category").append(option);
  }
  for (const c of m.cities) {
    const o = node("option", c.name);
    o.value = c.slug;
    $("cities").append(o);
  }
  notice(
    m.mode === "local-preview"
      ? "پیش‌نمایش محلی آماده است؛ اعلان تلگرام پس از اتصال به آیرا فعال می‌شود."
      : "ورود مشترک فعال؛ ارسال به آداپتور آیرا نیاز دارد.",
  );
  sourceLink();
} catch (e) {
  notice("بارگذاری انجام نشد: " + e.message, true);
}
