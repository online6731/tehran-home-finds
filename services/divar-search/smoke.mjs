// Explicit opt-in: a small live public-source probe, never a Telegram send.
import { PublicDivarProvider } from "./provider.mjs";
if (!process.argv.includes("--live"))
  throw Error("Pass --live to contact the public Divar source");
const checks = [];
for (const search of [
  { category: "mobile-phones", query: "سامسونگ", maxAgeHours: 168 },
  { category: "light", query: "پژو", city: "shiraz", maxAgeHours: 168 },
  { category: "apartment-sell", maxAgeHours: 168 },
]) {
  const result = await new PublicDivarProvider({
    maxDetails: 4,
    maxPages: 1,
  }).search(search);
  checks.push({
    search,
    coverage: result.coverage,
    scanned: result.scanned,
    errors: result.errors,
    sourceUrl: result.sourceUrl,
    ads: result.ads.map((a) => ({
      id: a.id,
      category: a.category,
      city: a.citySlug,
      title: a.title,
      price: a.price,
      priceLabel: a.priceLabel,
      photos: a.pics.length,
      postedAtIso: a.postedAtIso,
    })),
  });
}
console.log(
  JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2),
);
if (checks.some((r) => r.errors.length || !r.ads.length)) process.exitCode = 1;
