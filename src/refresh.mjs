import fs from 'node:fs';
import {categories,collectHtmlCategory} from './source.mjs';
import {isTehranCityListing,matchesAppliance,matchesDiningTable,matchesFurniture,matchesHomeCategory,diningChairs,storedPostingTime,preservePostingTime} from './divar.mjs';
import {attachReviews} from './quality.mjs';

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
const excludedIds=new Set(['gaLrWy1Y','gaLHWjwi','gaLvxgX_','gaLfmUW4','gaLbmG4W','gaLXm6J8','gaLLSabb','gaLv9KXr','gaLbsXSc','gaL_c6EH','gaLLrls3','gaL7MkzL','gaLT__M9','gaMrJQAL','gaMXZ7Jo','gaMr6j9P','gaNrU2LG','gaNLmDRV','gaN_EhLM','gaNHO2R3','gaNjsdvi','gaNf9JKj','gaNb91mX','gaNnthos']);
const slugByCategory=Object.fromEntries(Object.entries(categories).map(([slug,name])=>[name,slug]));
const priorById=new Map(prior.ads.map(ad=>[ad.id,ad]));
export function eligible(ad,time=now()){
  return ad&&slugByCategory[ad.category]&&matchesHomeCategory(slugByCategory[ad.category],ad.title,ad.desc)&&matchesAppliance(slugByCategory[ad.category],ad.title,ad.productFields||{},ad.desc)&&!excludedIds.has(ad.id)&&Number.isFinite(ad.price)&&ad.price>=1e6&&ad.price<=15e6&&
    ad.postedAt<=time&&ad.postedAt>time-86400000&&ad.expiresAt>time&&
    ['کارکرده','در حد نو'].includes(ad.condition)&&isTehranCityListing(ad)&&
    !outside.test([ad.area,ad.title,ad.desc].join(' '))&&
    (ad.category!==categories.furniture||matchesFurniture(ad.title))&&
    !(ad.category===categories.furniture&&cover.test(ad.title.replace(/\u200c/g,'')))&&
    !(ad.category===categories['rugs-woolen-cloth']&&/خورجین|موتور\s*سیکلت/u.test(ad.title))&&
    !(ad.category===categories['bed-service']&&/پاتختی/u.test(ad.title)&&!/(?:^|\s)تخت|سرویس\s*خواب/u.test(ad.title))&&
    !(ad.category===categories['shoe-rack-drawer']&&/رگال/u.test(ad.title)&&!/کمد|جا\s*کفشی/u.test(ad.title))&&
    (ad.category!==categories['dining-table']||matchesDiningTable(ad.title,ad.desc,ad.seats))&&
    Array.isArray(ad.pics)&&ad.pics.length&&ad.pics.every(u=>/^https:\/\/[a-z0-9.-]+\.divarcdn\.com\//.test(u));
}
const rows=Object.fromEntries(Object.entries(categories).map(([slug,name])=>[slug,{slug,name,...prior.categories.find(c=>c.slug===slug),ads:prior.ads.filter(a=>a.category===name&&eligible(a))}]));
const snapshotOnly=process.argv.includes('--snapshot-only');
const startedAt=snapshotOnly?(prior.sourceStatus?.lastStartedAt||null):now();
let finishedAt=prior.sourceStatus?.lastFinishedAt||null;
let hadFailures=false;
let reviews=[];
try{reviews=JSON.parse(fs.readFileSync(new URL('../data/quality-reviews.json',import.meta.url),'utf8'));}catch{}
async function writeSnapshot(){
  const status=Object.values(rows);
  const ads=await attachReviews([...new Map(status.flatMap(c=>c.ads).filter(a=>eligible(a)).map(a=>[a.id,{...storedPostingTime(a),chairs:diningChairs(a.title,a.desc)}])).values()].sort((a,b)=>a.price-b.price),reviews);
  const partial=status.some(c=>c.coverage!=='complete-24h-source'||c.error);
  const checkedAt=status.every(c=>c.checkedAt)?Math.min(...status.map(c=>c.checkedAt)):null;
  let message='آخرین دریافت: '+(finishedAt?new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',dateStyle:'short',timeStyle:'short'}).format(finishedAt):'هنوز انجام نشده');
  if(partial)message+=' · پوشش محدود؛ همهٔ صفحات منبع بررسی نشده‌اند';
  if(status.some(c=>c.error))message+=' · دریافت بخشی از منبع ناموفق بود';
  const snapshot={ads,checkedAt,categories:status.map(({ads,...c})=>c),coverage:partial?'بخشی از آگهی‌های تازهٔ دسته‌های انتخاب‌شده؛ همهٔ صفحات منبع بررسی نشده‌اند':'همهٔ صفحات دسته‌های انتخاب‌شده',sourceStatus:{message,partial,updating:false,lastStartedAt:startedAt,lastFinishedAt:finishedAt,hosting:'GitHub Pages',updateEveryHours:4},qualityError:prior.qualityError||null};
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
fs.writeFileSync(new URL('../docs/update-plan/index.html',import.meta.url),`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>برنامهٔ دریافت آگهی</title><body><h1>برنامهٔ دریافت آگهی</h1><p>دسته‌ها: ${Object.values(categories).join('، ')}.</p><p>دریافت خودکار توسط GitHub Actions هر ۴ ساعت، فقط شهر تهران، کارکرده یا در حد نو، انتشار در ۲۴ ساعت اخیر، قیمت ۱ تا ۱۵ میلیون تومان، همهٔ عکس‌ها و فاصلهٔ هوایی تقریبی محله تا مترو هفت‌تیر. میز غذاخوری حداقل شش نفره؛ گاز فقط رومیزی یا صفحه‌ای. لوازم یدکی، خدمات تعمیر و کالاهای نامرتبط پذیرفته نمی‌شوند. ممکن است منبع دریافت را محدود کند؛ پوشش و خطاها در api/listings.json ثبت می‌شود. دادهٔ معتبر پیشین فقط تا زمان انقضا حفظ می‌شود. زمان‌بندی GitHub ممکن است تأخیر داشته باشد. تگ کیفیت تنها با بررسی مستند عکس‌ها مجاز است؛ سلامت فنی وسایل برقی و گاز با عکس تأیید نمی‌شود.</p><p><a href="../">فهرست آگهی‌ها</a></p></body></html>`);
console.log(JSON.stringify({ads:result.ads.length,partial:result.sourceStatus.partial,hadFailures}));
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'source_failed='+hadFailures+'\n');
