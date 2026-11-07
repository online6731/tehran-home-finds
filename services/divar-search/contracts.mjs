import fs from "node:fs";
import { createHash } from "node:crypto";
export const taxonomy = JSON.parse(
  fs.readFileSync(new URL("../../data/divar-taxonomy.json", import.meta.url)),
);
export const normalize = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200fـ]/g, " ")
    .replace(/[۰-۹٠-٩]/g, (c) =>
      String(
        "۰۱۲۳۴۵۶۷۸۹".includes(c)
          ? "۰۱۲۳۴۵۶۷۸۹".indexOf(c)
          : "٠١٢٣٤٥٦٧٨٩".indexOf(c),
      ),
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
export class InputError extends Error {
  constructor(code) {
    super(code);
    this.status = 400;
  }
}
export function check(ok, code = "invalid_input") {
  if (!ok) throw new InputError(code);
}
export function object(value, allowed) {
  check(value && typeof value === "object" && !Array.isArray(value));
  check(
    Object.keys(value).every((k) => allowed.includes(k)),
    "unknown_field",
  );
}
export function text(v, max = 200) {
  check(typeof v === "string" && v.length <= max, "invalid_text");
  return v.trim();
}
const slug = (s) => {
  check(
    typeof s === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(s),
    "invalid_slug",
  );
  return s;
};
export const cities = [
  ["tehran", "تهران"],
  ["karaj", "کرج"],
  ["mashhad", "مشهد"],
  ["isfahan", "اصفهان"],
  ["shiraz", "شیراز"],
  ["tabriz", "تبریز"],
  ["qom", "قم"],
  ["rasht", "رشت"],
  ["ahvaz", "اهواز"],
  ["kermanshah", "کرمانشاه"],
].map(([slug, name]) => ({ slug, name }));
export function spec(input = {}) {
  object(input, [
    "version",
    "query",
    "city",
    "category",
    "minPrice",
    "maxPrice",
    "conditions",
    "areas",
    "exclude",
    "maxAgeHours",
    "requirePhotos",
    "fields",
  ]);
  const out = {
    version: 1,
    query: text(input.query ?? "", 500),
    city: slug(input.city ?? "tehran"),
    category: input.category ?? "ROOT",
    minPrice: input.minPrice ?? null,
    maxPrice: input.maxPrice ?? null,
    conditions: input.conditions ?? [],
    areas: input.areas ?? [],
    exclude: input.exclude ?? [],
    maxAgeHours: input.maxAgeHours ?? 24,
    requirePhotos: input.requirePhotos ?? true,
    fields: input.fields ?? {},
  };
  check(
    input.version === undefined || input.version === 1,
    "unsupported_version",
  );
  check(
    taxonomy.categories.some((c) => c.slug === out.category),
    "unknown_category",
  );
  for (const k of ["minPrice", "maxPrice"])
    check(
      out[k] === null ||
        (Number.isSafeInteger(out[k]) && out[k] >= 0 && out[k] <= 1e15),
      "invalid_price",
    );
  check(
    out.minPrice === null ||
      out.maxPrice === null ||
      out.minPrice <= out.maxPrice,
    "inverted_price_range",
  );
  check(
    Number.isFinite(out.maxAgeHours) &&
      out.maxAgeHours >= 1 &&
      out.maxAgeHours <= 168,
    "invalid_age",
  );
  check(typeof out.requirePhotos === "boolean");
  for (const k of ["conditions", "areas", "exclude"]) {
    check(Array.isArray(out[k]) && out[k].length <= 20);
    out[k] = [...new Set(out[k].map((v) => text(v, 100)))];
  }
  check(
    out.conditions.every((c) => ["نو", "در حد نو", "کارکرده"].includes(c)),
    "invalid_condition",
  );
  object(out.fields, Object.keys(out.fields));
  check(Object.keys(out.fields).length <= 20);
  for (const [key, value] of Object.entries(out.fields)) {
    text(key, 100);
    text(value, 200);
  }
  return out;
}
export const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const specKey = (s) => fingerprint(spec(s));
export function parseIntent(raw) {
  text(raw, 2000);
  let q = normalize(raw).replace(/[0-9]+(?:[,٬][0-9]{3})+(?![0-9])/g, (n) =>
    n.replace(/[,٬]/g, ""),
  );
  const extracted = {},
    questions = [],
    warnings = [];
  const mentionedCities = cities.filter((c) => q.includes(c.name));
  if (mentionedCities.length > 1)
    questions.push(
      "بیش از یک شهر دیده شد؛ این جست‌وجو فقط یک شهر می‌پذیرد. شهر فیلتر را تأیید کنید.",
    );
  const city = mentionedCities[0];
  if (city) {
    extracted.city = city.slug;
    q = q.replace(city.name, " ");
  } else questions.push("شهر موردنظر را انتخاب کنید؛ پیش‌فرض فعلی تهران است.");
  // Conservative suggestions: all extracted filters remain editable before saving.
  const aliases = [
    [/لباسشویی|لباس شویی/, "washing-machines"],
    [/ظرفشویی|ظرف شویی/, "dishwasher"],
    [/یخچال|فریزر/, "refrigerator-freezer"],
    [/آینه|اینه/, "mirror"],
    [/مبل|کاناپه/, "furniture"],
    [/گوشی|موبایل|آیفون|ایفون/, "mobile-phones"],
    [/لپ تاپ|لپتاپ/, "laptops"],
    [/استخدام|کاریابی/, "jobs"],
    [/آپارتمان.*اجاره|اجاره.*آپارتمان/, "apartment-rent"],
    [/آپارتمان.*خرید|خرید.*آپارتمان/, "apartment-sell"],
    [/خودرو|ماشین سواری|پژو|پراید/, "light"],
  ];
  for (const [p, category] of aliases)
    if (p.test(q) && taxonomy.categories.some((c) => c.slug === category)) {
      extracted.category = category;
      break;
    }
  const rentalMoney = /رهن|ودیعه|اجاره/.test(q) && /[0-9]/.test(q);
  if (rentalMoney)
    questions.push(
      "رهن، ودیعه و اجاره مبلغ‌های جدا دارند؛ این نسخه آن‌ها را به یک سقف قیمت تبدیل نمی‌کند. ویژگی دقیق را انتخاب کنید.",
    );
  const money =
    "([0-9]+(?:[.,٫][0-9]+)?)\\s*(هزار|میلیون|میلیارد)?\\s*(تومان|تومن|ریال)?";
  const amount = (n, u, c) =>
    (Number(n.replace(/[٫,]/g, ".")) *
      ({ هزار: 1e3, میلیون: 1e6, میلیارد: 1e9 }[u] || 1)) /
    (c === "ریال" ? 10 : 1);
  const range = q.match(
    new RegExp("(?:بین|از)\\s*" + money + "\\s*تا\\s*" + money),
  );
  if (!rentalMoney && range && (range[2] || range[3] || range[5] || range[6])) {
    extracted.minPrice = amount(
      range[1],
      range[2] || range[5],
      range[3] || range[6],
    );
    extracted.maxPrice = amount(
      range[4],
      range[5] || range[2],
      range[6] || range[3],
    );
    q = q.replace(range[0], " ");
  } else {
    const cap = q.match(
      new RegExp("(?:حداکثر|زیر|تا|بودجه(?: ام)?|ارزان تر از)\\s*" + money),
    );
    if (!rentalMoney && cap && (cap[2] || cap[3])) {
      extracted.maxPrice = amount(cap[1], cap[2], cap[3]);
      q = q.replace(cap[0], " ");
    } else if (/بودجه|قیمت|میلیون|میلیارد/.test(q))
      questions.push("بازهٔ قیمت و واحد پول را در فیلترها مشخص کنید.");
  }
  if (/در حد نو/.test(q)) {
    extracted.conditions = ["در حد نو"];
    q = q.replace(/در حد نو/g, " ");
  } else if (/کارکرده|دست دوم/.test(q)) {
    extracted.conditions = ["کارکرده", "در حد نو"];
    q = q.replace(/کارکرده|دست دوم/g, " ");
  } else if (/(?:^|\s)نو(?:\s|$)/.test(q) && !/نه نو|نو نمی/.test(q)) {
    extracted.conditions = ["نو"];
    q = q.replace(/(?:^|\s)نو(?=\s|$)/g, " ");
  }
  const neg = q.match(/(?:بدون|به جز)\s+([\p{L}\p{N}]+)/u);
  if (neg) {
    extracted.exclude = [neg[1]];
    q = q.replace(neg[0], " ");
    warnings.push(
      "واژهٔ بعد از «بدون/به‌جز» به‌عنوان حذف پیشنهاد شد؛ آن را تأیید کنید.",
    );
  }
  q = q
    .replace(
      /می خوام|میخوام|می خواهم|میخواهم|می گردم|میگردم|برام|برای من|جستجو کن|سرچ کن|پیدا کن|لطفا|دنبال|هستم|بگرد|هروقت|هر وقت|خبرم کن|اطلاع بده|میلیون تومان/g,
      " ",
    )
    .replace(/(?:^|\s)(?:یه|یک|در|با|به|رو|را|و|تا)(?=\s|$)/g, " ");
  extracted.query = normalize(q);
  warnings.push(
    "برداشت اولیه قطعی نیست؛ مدل زبانی در این نسخه متصل نشده و توضیح‌های پیچیده به تأیید فیلتر نیاز دارند.",
  );
  return { spec: spec(extracted), questions, warnings, original: raw };
}
export function matches(ad, s, now = Date.now()) {
  if (
    !ad ||
    ad.citySlug !== s.city ||
    !Number.isFinite(ad.postedAt) ||
    ad.postedAt > now ||
    ad.postedAt < now - s.maxAgeHours * 3600000
  )
    return false;
  if (s.category !== "ROOT") {
    let c = taxonomy.categories.find((c) => c.slug === ad.category);
    while (c && c.slug !== s.category)
      c = taxonomy.categories.find((p) => p.slug === c.parent);
    if (!c) return false;
  }
  if (s.requirePhotos && !ad.pics?.length) return false;
  if (s.conditions.length && !s.conditions.includes(ad.condition)) return false;
  if (
    (s.minPrice !== null || s.maxPrice !== null) &&
    !Number.isFinite(ad.price)
  )
    return false;
  if (
    (s.minPrice !== null && ad.price < s.minPrice) ||
    (s.maxPrice !== null && ad.price > s.maxPrice)
  )
    return false;
  if (
    s.areas.length &&
    !s.areas.some((a) => normalize(ad.area).includes(normalize(a)))
  )
    return false;
  const hay = normalize(
    [ad.title, ad.desc, Object.values(ad.fields || {}).join(" ")].join(" "),
  );
  if (
    normalize(s.query)
      .split(" ")
      .filter(Boolean)
      .some((word) => !hay.includes(word))
  )
    return false;
  if (s.exclude.some((w) => hay.includes(normalize(w)))) return false;
  return Object.entries(s.fields).every(([k, v]) =>
    Object.entries(ad.fields || {}).some(
      ([label, value]) =>
        normalize(label) === normalize(k) && normalize(value) === normalize(v),
    ),
  );
}
