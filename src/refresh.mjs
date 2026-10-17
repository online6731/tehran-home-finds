import fs from 'node:fs';
import {categories,collectHtmlCategory} from './source.mjs';
import {isTehranCityListing,matchesAppliance,matchesDiningTable,matchesFurniture,matchesHomeCategory,matchesDoubleBed,diningChairs,storedPostingTime,preservePostingTime} from './divar.mjs';
import {attachReviews} from './quality.mjs';
import {listingDistance} from './locations.mjs';
import {conditionScore} from './condition-score.mjs';
import {attachPhotoAssessment} from './photo-assessment.mjs';
import {matchesAdultRug} from './rugs.mjs';
import {matchesAdultProduct} from './audience.mjs';
const coordinates=JSON.parse(fs.readFileSync(new URL('./area_coordinates.json',import.meta.url),'utf8'));

const target=new URL('../docs/api/listings.json',import.meta.url);
let prior={ads:[],categories:[]};
try{prior=JSON.parse(fs.readFileSync(target,'utf8'));}catch{}
const now=()=>Date.now();
const outside=/(?:گرم\s*دره|صفا\s*دشت|صبا\s*شهر|صالح\s*آباد\s*غربی)/u;
const cover=/رو\s*مبلی/u;
// gaLLSabb explicitly advertises imported, completely new goods despite its
// "like new" form value; it is outside the used/like-new household catalog.
// gaLv9KXr requires buying both rugs for 20 million; the 10 million form
// value is for one rug and the seller explicitly refuses individual sales.
// Gallery inspection confirmed these four bed listings sell support boards
// or a detached lifting grid, and gaLT__M9 sells only wardrobe doors/panels.
// gaMrJQAL: gallery contains only two wood/MDF support panels. gaMXZ7Jo:
// three clothing racks, with a misspelled title. gaMr6j9P: minimum sale is
// two rugs for 25 million despite the 12.5 million per-rug form price.
// gaNrU2LG explicitly offers two loose chipboard bed-support boards.
// gaNLmDRV requires an additional payment above its 15 million form price.
// Gallery evidence: gaN_EhLM is a detached lift/Murphy mechanism frame
// with mounting tabs and no floor legs.
// gaNHO2R3 and gaNjsdvi explicitly sell only loose mattress-support boards.
// All gallery photos of gaNf9JKj and gaNb91mX show detached mounting frames
// without floor legs. gaNnthos sells four loose drawers, confirmed by its photo.
// gaNH08UZ: its 15 million form price buys only the 2-metre rug; the
// adult-sized 4/9-metre rugs cost 25/45 million according to the description.
const excludedIds=new Set(['gaNH08UZ','gaLrWy1Y','gaLHWjwi','gaLvxgX_','gaLfmUW4','gaLbmG4W','gaLXm6J8','gaLLSabb','gaLv9KXr','gaLbsXSc','gaL_c6EH','gaLLrls3','gaL7MkzL','gaLT__M9','gaMrJQAL','gaMXZ7Jo','gaMr6j9P','gaNrU2LG','gaNLmDRV','gaN_EhLM','gaNHO2R3','gaNjsdvi','gaNf9JKj','gaNb91mX','gaNnthos']);
// Full gallery/text review 2026-10-17 05:05: rug buyer solicitation, and
// a gas listing whose gallery shows a freestanding oven plus a refrigerator.
for(const id of ['gaSb_t5z','gaS7fok2'])excludedIds.add(id);
// The changed title now explicitly calls this a diaper washer; adult-only
// eligibility is unclear, so hold it until the intended use is established.
excludedIds.add('gaSTnx9Z');
// Gallery/text review: a lone bedside cabinet misfiled as a double bed,
// and an office filing safe outside the household dresser category.
for(const id of ['gaTrwWHP','gaTfA4-W'])excludedIds.add(id);
// Full gallery/text review 2026-10-16 09:31: shop cabinetry, mixed rugs
// lacking runner dimensions, explicit 120cm bed, wrong product price,
// unpictured complete bed/sofa, and a non-household display cabinet.
for(const id of ['gaRnOYTS','gaRL_Zym','gaR3eA5x','gaRH-wUq','gaRzMLVe','gaRPuzeG','gaRDOUZE'])excludedIds.add(id);
// Follow-up scheduled snapshot: unclear bundle price, carton-only/stock images,
// mixed doormat lot, unused bed boards, and unconfirmed per-rug pair price.
for(const id of ['gaRTvWrM','gaRn_Nfj','gaRfP-T1','gaRnfcEy','gaRLvquX','gaRTPZ5o'])excludedIds.add(id);
// The pirate boat bed and ship-wheel mirror are excluded by the matching
// fingerprinted teen audience evidence (gallery photos 1 and 3).
// Mirror gallery/text review: incomplete broken mirror lot with an ambiguous
// bundle price, and an empty metal frame whose mirror is explicitly broken.
for(const id of ['gaQT3PZs','gaQHHLoj'])excludedIds.add(id);
// Full gallery/text review: loose mattress-support boards, and a handheld
// vacuum powered through a vehicle cigarette-lighter cable (not household).
for(const id of ['gaR71pqa','gaRrldtA'])excludedIds.add(id);
// Full gallery/text review: six-compartment industrial changing-room locker,
// and a furniture bundle explicitly including a four-seat dining set.
for(const id of ['gaR3ZW3A','gaRfqrej'])excludedIds.add(id);
// Full gallery/text review 2026-10-16 06:19: a room door misfiled as a dresser,
// a second ad with the same green sofa gallery, and an ambiguous refrigerator
// bundle including an unpictured gas heater. Keep these out of public delivery.
for(const id of ['gaRD8FKI','gaR36hgm','gaRbcx8E'])excludedIds.add(id);
// Full gallery/text review 2026-10-16 08:23: ironing cabinet, measured rug
// below 4m2, mixed four-seat dining lot, loose wardrobe doors, Tabriz rug,
// ambiguous prices/unused desk bundle and repeat green-sofa galleries.
for(const id of ['gaRvN8Zu','gaRndQP2','gaRbNUGP','gaR7Nb74','gaRfM4_t','gaR3NIOW','gaRb8qfZ','gaRndgrO','gaRzs9Hl','gaRz9M3w','gaRvNYK3'])excludedIds.add(id);
// Full gallery review 2026-10-15 23:11: a placeholder-price furniture lot,
// a free refrigerator with only a stock image, and table frames without a top.
for(const id of ['gaRDU2QJ','gaR_jvop','gaRzU_gr'])excludedIds.add(id);
// Full gallery review 2026-10-15 21:10: detached mattress support, clothes
// stand, hospital bedside cabinet, and lots with unverified bed/table sizes.
for(const id of ['gaRXj_iJ','gaRLzA95','gaR_CAGl','gaRnCyIk','gaR_yjJI'])excludedIds.add(id);
// gaRHDf0Q includes a cartoon rug in photo 2; the fingerprinted child audience
// evidence in quality-reviews.json excludes the entire mixed listing.
// All three gallery photos show shop display refrigerators and a pickle counter.
excludedIds.add('gaOfGnqD');
// gaOj4I4y requires buying both rugs for 22 million; per-rug form price is 11m.
// gaOLpMZ_ sells specialised optician display drawers, outside household goods.
excludedIds.add('gaOj4I4y');
excludedIds.add('gaOLpMZ_');
// Seller descriptions explicitly offer unused goods, outside used/like-new scope.
// gaP_HOXZ: "استفاده نشده با کارتن"; gaP3HrRO: "اصلا استفاده نشده".
excludedIds.add('gaP_HOXZ');
excludedIds.add('gaP3HrRO');
// Seller requires all four rugs together for 55 million, outside the budget.
excludedIds.add('gaPvNvbZ');
// Gallery and seller text: commercial kitchen chillers, outside household goods.
excludedIds.add('gaQTwF3A');
excludedIds.add('gaP7OFFS');
// Both six-metre rugs must be purchased together for 27 million toman.
excludedIds.add('gaP3etwu');
// Seller explicitly says this blanket washer is unused, only unwrapped.
excludedIds.add('gaQnVBs6');
// Seller requires the two nominal four-metre rugs together with two doormats.
excludedIds.add('gaQvk7ds');
// Seller offers industrial lockers and filing cabinets; not household storage.
excludedIds.add('gaQfGk-K');
// Seller explicitly says the two rugs have never been used.
excludedIds.add('gaQPmh9r');
// Seller includes a small rug of unverified size in the six-metre rug bundle;
// both are visible in the gallery, so the bundle does not meet the size rule.
excludedIds.add('gaQjHreb');
// Gallery shows loose support boards and a headboard, not a complete bed.
excludedIds.add('gaQ34ROg');
// Bundles include undersized rugs or doormats (or rugs of unconfirmed size).
for(const id of ['gaQX66rL','gaQ3Ycgg','gaQjpatW','gaQbZ6uh','gaQ74_H4'])excludedIds.add(id);
// A four-seat dining set in the bundle is below the requested six-seat minimum.
excludedIds.add('gaQ_okhM');
// A bed bundled with a vanity has no confirmed double-bed size/type.
excludedIds.add('gaQn5ECk');
// Bundle explicitly includes unused oven/vacuum products, outside used scope.
excludedIds.add('gaQPpAW8');
// Photos show two detached bed-support boards, no assembled bed frame.
excludedIds.add('gaQPZ1Iu');
// Despite its vacuum title, the photo shows a steam mop, outside vacuum scope.
excludedIds.add('gaQ_Y1vD');
// Seller requires a phone call for the actual price; one million is a placeholder.
excludedIds.add('gaQ_qMk-');
// Gallery/text show a separate support grid, footstool, coat stand, or vanity only.
for(const id of ['gaQHrbkN','gaQraU4G','gaQ761t3','gaQnbNih'])excludedIds.add(id);
// Mixed rug lots contain doormats/small rugs or runners without both dimensions.
for(const id of ['gaQzbQX2','gaQzrPTy'])excludedIds.add(id);
// Seller explicitly includes unused products, outside the used/like-new scope.
for(const id of ['gaQ3bAQg','gaQj6ojR','gaQ7bQIt','gaQ7KiiH'])excludedIds.add(id);
// Seller explicitly locates the antique rug outside Tehran and offers shipping.
excludedIds.add('gaQ3KUvM');
// Full gallery/text review on 2026-10-15: measured rugs below 4m2 and
// bundles containing undersized rugs or rugs without confirmed dimensions.
for(const id of ['gaQntudH','gaQ_r3KF','gaQjM-yO','gaQftU3n','gaQf8YtX','gaQ_LUin'])excludedIds.add(id);
// Seller states delivery in Fardis, beyond Tehran city.
excludedIds.add('gaQncF99');
// Kitchen cabinetry miscategorised as a wardrobe; dining set has only 3 chairs.
for(const id of ['gaQz82Nb','gaQDd5TC'])excludedIds.add(id);
// Actual price requires contacting seller; form price is not confirmed.
excludedIds.add('gaQvNsR1');
// Seller explicitly includes unused goods, outside the used/like-new scope.
for(const id of ['gaQ7bFmn','gaQbtBqh'])excludedIds.add(id);
// Full gallery review 2026-10-15 20:08: mixed or ambiguous lots, workshop
// storage, unconfirmed prices, new goods, undersized
// dining layouts, and rugs bundled with a runner lacking both dimensions.
for(const id of ['gaRzAPL1','gaRLhe-J','gaRXiyiG','gaRfxBF0','gaR7QTtj','gaR3g_y-','gaRnBHb4','gaR_BXwl','gaRvASQc','gaRfRrv_','gaR3AWRL','gaR3hLG2'])excludedIds.add(id);
// The Cinderella and Mickey/Minni rugs are excluded by fingerprinted
// audience evidence in quality-reviews.json, using all four / one photos.
// Full gallery review 2026-10-15 18:11: unconfirmed used commercial stock,
// covers/support boards, ambiguous washer lot, non-household cabinets,
// outside-Tehran goods, and a bundle with a four-seat dining table.
for(const id of ['gaQTeNNB','gaQHf3r4','gaQju3UV','gaQf_HyH','gaQXffmQ','gaRPAvZ9','gaQfOWmo','gaQzvddm','gaQfuyPU','gaQ_PlE0','gaRjgykV','gaQH-X5K'])excludedIds.add(id);
// Explicit measured dimensions are below 4m2, despite nominal four-metre titles.
for(const id of ['gaQf_7z6','gaQDd8Dv'])excludedIds.add(id);
// Baby washer and mixed-lot stroller/crib are removed by fingerprinted audience
// evidence in quality-reviews.json after review validation below.
const slugByCategory=Object.fromEntries(Object.entries(categories).map(([slug,name])=>[name,slug]));
const priorById=new Map(prior.ads.map(ad=>[ad.id,ad]));
export function eligible(ad,time=now()){
  return ad&&matchesAdultProduct(ad.title,ad.desc,ad.productFields)&&slugByCategory[ad.category]&&matchesHomeCategory(slugByCategory[ad.category],ad.title,ad.desc)&&matchesAppliance(slugByCategory[ad.category],ad.title,ad.productFields||{},ad.desc)&&!excludedIds.has(ad.id)&&Number.isFinite(ad.price)&&ad.price>=1e6&&ad.price<=15e6&&
    ad.postedAt<=time&&ad.postedAt>time-86400000&&ad.expiresAt>time&&
    ['کارکرده','در حد نو'].includes(ad.condition)&&isTehranCityListing(ad)&&
    (ad.category!==categories['bed-service']||matchesDoubleBed(ad.title,ad.desc,ad.productFields))&&
    (!['فرش','گلیم و جاجیم'].includes(ad.category)||matchesAdultRug(ad.title,ad.desc,ad.productFields))&&
    !outside.test([ad.area,ad.title,ad.desc].join(' '))&&
    (ad.category!==categories.furniture||matchesFurniture(ad.title))&&
    !(ad.category===categories.furniture&&cover.test(ad.title.replace(/\u200c/g,'')))&&
    !(ad.category===categories['rugs-woolen-cloth']&&/خورجین|موتور\s*سیکلت/u.test(ad.title))&&
    !(ad.category===categories['bed-service']&&/پاتختی/u.test(ad.title)&&!/(?:^|\s)تخت|سرویس\s*خواب/u.test(ad.title))&&
    !(ad.category===categories['shoe-rack-drawer']&&/رگال/u.test(ad.title)&&!/کمد|جا\s*کفشی/u.test(ad.title))&&
    (ad.category!==categories['dining-table']||matchesDiningTable(ad.title,ad.desc,ad.seats))&&
    Array.isArray(ad.pics)&&ad.pics.length&&ad.pics.every(u=>/^https:\/\/[a-z0-9.-]+\.divarcdn\.com\//.test(u));
}
// Full gallery/text review 2026-10-16 12:02: wrong products, narrow beds,
// unverified rug lots, staged/unused goods, incomplete table and price conflict.
for(const id of ["gaSHxUrX","gaSnwlY6","gaSLxIvi","gaS3gGOS","gaSXgOIf","gaSHwrHe","gaRnf6A2","gaSXh4zp","gaSLQKPt","gaR_fQe1","gaR__DA2","gaSrQAkm","gaSfgilb","gaSDg0mC"])excludedIds.add(id);
// Full gallery/text review 2026-10-16 14:17: wrong products, narrow beds,
// unverified rug lots, staged/unused goods, incomplete table and price conflict.
for(const id of ["gaSPRU_D","gaS_SBrx","gaSvhXKr","gaS_xzis","gaS_wtdS","gaSfS8gh","gaSPjsDU","gaS_Rdeg","gaSDiX6h","gaSvhzME","gaSfhnHh","gaS7hWqM","gaRf4aeZ","gaSHiwyb","gaSrhERC","gaSLCR-E","gaSPygn0","gaSXi5zL","gaSfh2kP","gaSPyfWG","gaS3RQJQ","gaSbBgYD","gaS3hXiv","gaSjSjCS","gaS3xRWr"])excludedIds.add(id);
// Full gallery/text review 2026-10-16 15:26 supplemental: wrong products, narrow beds,
// unverified rug lots, staged/unused goods, incomplete table and price conflict.
for(const id of ["gaSXTh_h","gaSbDn5s","gaSXjO1y","gaSzDbeq","gaSbTXAG","gaSTj0Bg","gaS_Dqve"])excludedIds.add(id);
// Full gallery/text review 2026-10-16 16:57: price/product/size conflicts,
// unused/staged goods, uncertain audience and duplicate bedroom set.
for(const id of ["gaS7D_M1","gaSzEA13","gaSj1Rlp","gaSnEo0N","gaSrkkaU","gaS_jls6","gaSHEGfe","gaRn5QtG","gaSrEF0U","gaSfUh3h","gaSTUH-H","gaSzUKvx","gaSbUDnd"])excludedIds.add(id);
// Full gallery/text review 2026-10-16 20:00: unconfirmed table capacity,
// undimensioned runner lots, narrow bedroom set and four-seat dining bundles.
for(const id of ["gaSD3rYv","gaSvW15f","gaSPGmDw","gaS7lL9i","gaS3FvgU"])excludedIds.add(id);
// Full gallery/text review 2026-10-16 21:02: unconfirmed sizes and photo provenance,
// ambiguous prices, four-seat dining bundle and unclear mixed lot.
for(const id of ["gaSn2HPv","gaSbYSP7","gaSrnErE","gaSjIOYt","gaSLI2_y","gaS33Szy"])excludedIds.add(id);
// Full gallery/text review 2026-10-17 07:17: price conflict, clothes hangers,
// mixed building doors, placeholder photos, unclear adult use, single sleeper and duplicate.
for(const id of ['gaTPiSts','gaTDC8UJ','gaTvxxGZ','gaTLiExv','gaTDSby0','gaT_AZCG','gaTfhm0X','gaTrQv-0'])excludedIds.add(id);
// Full gallery/text review 2026-10-17 08:23: price conflict, single sleepers,
// unclear photo provenance, filing cabinets, duplicate items and an unpriced rug lot.
for(const id of ['gaTTizrr','gaT_i30a','gaTXSx1E','gaT3S22w','gaTXis6j','gaTzic5M','gaTPiZFJ','gaTDDUgL'])excludedIds.add(id);
// Full gallery/text review 2026-10-17 10:21: ambiguous prices and provenance,
// duplicate items, unconfirmed sleeper/table/rug dimensions and unused rug.
// The balloon cabinet is excluded by its fingerprinted child-audience review.
for(const id of ['gaT_j3tB','gaTPEKP5','gaTXEA41','gaTXkT2u','gaTH0h2C','gaTzkzLO','gaT3kIce','gaTbE5TA','gaTnTIWa','gaTTkjSy','gaT_0I5t','gaTD0os_','gaTjkTkq','gaTHENwn'])excludedIds.add(id);
const rows=Object.fromEntries(Object.entries(categories).map(([slug,name])=>[slug,{slug,name,...prior.categories.find(c=>c.slug===slug),ads:prior.ads.filter(a=>a.category===name&&eligible(a))}]));
const snapshotOnly=process.argv.includes('--snapshot-only');
const startedAt=snapshotOnly?(prior.sourceStatus?.lastStartedAt||null):now();
let finishedAt=prior.sourceStatus?.lastFinishedAt||null;
let hadFailures=false;
let reviews=[];
try{reviews=JSON.parse(fs.readFileSync(new URL('../data/quality-reviews.json',import.meta.url),'utf8'));}catch{}
let photoAssessments=[];
try{photoAssessments=JSON.parse(fs.readFileSync(new URL('../data/photo-assessments.json',import.meta.url),'utf8'));}catch{}
const photoById=new Map(photoAssessments.map(a=>[a.id,a]));
async function writeSnapshot(){
  const status=Object.values(rows);
  const reviewed=await attachReviews([...new Map(status.flatMap(c=>c.ads).filter(a=>eligible(a)).map(a=>[a.id,{...storedPostingTime(a),...listingDistance(a,coordinates),chairs:diningChairs(a.title,a.desc)}])).values()].sort((a,b)=>a.price-b.price),reviews);
  const withPhotos=await Promise.all(reviewed.map(ad=>attachPhotoAssessment(ad,photoById.get(ad.id))));
  // Apply visual audience exclusions only after fingerprint validation, so a
  // changed description/gallery cannot inherit an unrelated photo assessment.
  const ads=withPhotos.filter(ad=>matchesAdultProduct(ad.title,ad.desc,ad.productFields,ad.photoAssessment)&&matchesAdultProduct(ad.title,ad.desc,ad.productFields,ad.quality)).filter(ad=>!['فرش','گلیم و جاجیم'].includes(ad.category)||matchesAdultRug(ad.title,ad.desc,ad.productFields,ad.photoAssessment)).map(ad=>({...ad,conditionAssessment:conditionScore(ad)}));
  const partial=status.some(c=>c.coverage!=='complete-24h-source'||c.error);
  const checkedAt=status.every(c=>c.checkedAt)?Math.min(...status.map(c=>c.checkedAt)):null;
  let message='آخرین دریافت: '+(finishedAt?new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',dateStyle:'short',timeStyle:'short'}).format(finishedAt):'هنوز انجام نشده');
  if(partial)message+=' · پوشش محدود؛ همهٔ صفحات منبع بررسی نشده‌اند';
  if(status.some(c=>c.error))message+=' · دریافت بخشی از منبع ناموفق بود';
  const snapshot={ads,checkedAt,categories:status.map(({ads,...c})=>c),coverage:partial?'بخشی از آگهی‌های تازهٔ دسته‌های انتخاب‌شده؛ همهٔ صفحات منبع بررسی نشده‌اند':'همهٔ صفحات دسته‌های انتخاب‌شده',sourceStatus:{message,partial,updating:false,lastStartedAt:startedAt,lastFinishedAt:finishedAt,hosting:'GitHub Pages',updateEveryHours:1},qualityError:prior.qualityError||null};
  fs.writeFileSync(target,JSON.stringify(snapshot));
  return snapshot;
}
if(!snapshotOnly){
  const maxPages=Number(process.env.MAX_PAGES||200);
  const selected=(process.env.CATEGORY_SLUGS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(selected.some(slug=>!categories[slug]))throw Error('Unknown category selection');
  for(const [slug,name] of Object.entries(categories)){
    if(selected.length&&!selected.includes(slug))continue;
    const old=rows[slug];
    const attempt=now();
    try{
      const result=await collectHtmlCategory(slug,old.ads,p=>console.log(JSON.stringify(p)),{maxPages,maxDurationMs:3*60*1000});
      const complete=result.coverage==='complete-24h-source'&&!result.failures.length;
      const fresh=new Map((complete?[]:old.ads).filter(a=>eligible(a)).map(a=>[a.id,a]));
      for(const id of result.rejectedIds||[])fresh.delete(id);
      for(const fetched of result.ads){const ad=preservePostingTime(fetched,priorById.get(fetched.id));if(eligible(ad))fresh.set(ad.id,ad);else fresh.delete(ad.id);}
      hadFailures ||= result.failures.length>0;
      rows[slug]={slug,name,ads:[...fresh.values()],checkedAt:complete?now():old.checkedAt||null,lastAttemptAt:attempt,lastFetchedAt:result.ads.length?now():old.lastFetchedAt||null,error:result.failures.length?'دریافت بعضی آگهی‌ها انجام نشد':null,coverage:result.coverage,scanned:result.scanned,pages:result.pages,hasMore:result.hasMore};
      console.log(JSON.stringify({slug,count:result.ads.length,coverage:result.coverage,failures:result.failures}));
    }catch(error){hadFailures=true;rows[slug]={...old,lastAttemptAt:attempt,error:'دریافت منبع انجام نشد',coverage:'source-unavailable'};console.error(slug+': '+error.message);}
    finishedAt=now();await writeSnapshot();
  }
}
const result=await writeSnapshot();
fs.mkdirSync(new URL('../docs/update-plan/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../docs/update-plan/index.html',import.meta.url),`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>برنامهٔ دریافت آگهی</title><body><h1>برنامهٔ دریافت آگهی</h1><p>دسته‌ها: ${Object.values(categories).join('، ')}.</p><p>دریافت خودکار توسط GitHub Actions هر ساعت، فقط شهر تهران، کارکرده یا در حد نو، انتشار در ۲۴ ساعت اخیر، قیمت ۱ تا ۱۵ میلیون تومان، همهٔ عکس‌ها و فاصلهٔ هوایی تقریبی محله تا مترو هفت‌تیر. در تمام دسته‌ها، آگهی‌های مرتبط با کودک، نوجوان، نوزاد و سیسمونی و طرح‌های کودکانه حذف می‌شوند؛ این قاعده شامل آگهی‌های چندکالایی و لوازم برقی نیز هست. میز غذاخوری حداقل شش نفره؛ تخت فقط دونفره (تک‌نفره، نوجوان، کودک و دوطبقه حذف می‌شوند)؛ فرش و گلیم فقط طرح بزرگسال و اندازهٔ اسمی حداقل ۴ متری؛ ابعاد اندازه‌گیری‌شده حداقل ۴ مترمربع و کناره با طول و عرض مشخص. طرح کودک/نوجوان، اندازهٔ کوچک‌تر و اندازهٔ تأییدنشده حذف می‌شوند؛ گاز فقط رومیزی یا صفحه‌ای. لوازم یدکی، خدمات تعمیر و کالاهای نامرتبط پذیرفته نمی‌شوند. ممکن است منبع دریافت را محدود کند؛ پوشش و خطاها در api/listings.json ثبت می‌شود. دادهٔ معتبر پیشین فقط تا زمان انقضا حفظ می‌شود. زمان‌بندی GitHub ممکن است تأخیر داشته باشد. فاصله بر پایهٔ نقشهٔ آگهی یا مرکز/نقطهٔ مرجع مستند محله با ذکر مبنا محاسبه می‌شود. گالری در عکس اصلی ورق می‌خورد. هر محصول امتیاز وضعیت تخمینی و شاخص فاصله با نو دارد؛ امتیاز توضیح‌محور از ارزیابی مستند عکس‌ها جداست و شاخص، درصد واقعی استهلاک نیست. تگ کیفیت تنها با بررسی مستند عکس‌ها مجاز است؛ سلامت فنی وسایل برقی و گاز با عکس تأیید نمی‌شود.</p><p><a href="../">فهرست آگهی‌ها</a></p></body></html>`);
console.log(JSON.stringify({ads:result.ads.length,partial:result.sourceStatus.partial,hadFailures}));
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'source_failed='+hadFailures+'\n');
