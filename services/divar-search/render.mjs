const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function renderListing(ad) {
  const date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ad.postedAt);
  const price = Number.isFinite(ad.price)
    ? new Intl.NumberFormat("fa-IR").format(ad.price) + " تومان"
    : ad.priceText || "قیمت اعلام نشده";
  return {
    text: `${ad.title}\n${price}\n${ad.area} · ${ad.citySlug}\nثبت دیوار: ${date}\nعکس‌ها بررسی نشده‌اند\n${ad.url}`,
    rich: `<p><b>${esc(ad.title)}</b><br>${esc(price)}<br>${esc(ad.area)} · ${esc(ad.citySlug)}<br>ثبت دیوار: ${esc(date)} (تهران)</p><tg-slideshow>${ad.pics.map((_, i) => `<img src="tg://photo?id=p${i + 1}"/>`).join("")}</tg-slideshow><details><summary>توضیحات</summary><p>${esc(ad.desc)}</p><p>ادعای فروشنده؛ عکس‌ها ارزیابی نشده‌اند و سلامت فنی تأیید نشده است.</p></details>`,
    photos: [...ad.pics],
    url: ad.url,
  };
}
