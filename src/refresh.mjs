import fs from 'node:fs';
import {categories,collectHtmlCategory} from './source.mjs';
import {isTehranCityListing} from './divar.mjs';

const target=new URL('../docs/api/listings.json',import.meta.url);
let prior={ads:[],categories:[]};
try{prior=JSON.parse(fs.readFileSync(target,'utf8'));}catch{}
const now=()=>Date.now();
const outside=/(?:گرم\s*دره|صفا\s*دشت|صبا\s*شهر|صالح\s*آباد\s*غربی)/u;
const cover=/رو\s*مبلی/u;
const excludedIds=new Set(['gaLrWy1Y','gaLHWjwi','gaLvxgX_']);
export function eligible(ad,time=now()){
  return ad&&!excludedIds.has(ad.id)&&Number.isFinite(ad.price)&&ad.price>=1e6&&ad.price<=15e6&&
    ad.postedAt<=time&&ad.postedAt>time-86400000&&ad.expiresAt>time&&
    ['کارکرده','در حد نو'].includes(ad.condition)&&isTehranCityListing(ad)&&
    !outside.test([ad.area,ad.title,ad.desc].join(' '))&&
    !(ad.category===categories.furniture&&cover.test(ad.title.replace(/\u200c/g,'')))&&
    !(ad.category===categories['rugs-woolen-cloth']&&/خورجین|موتور\s*سیکلت/u.test(ad.title))&&
    (ad.category!==categories['dining-table']||ad.seats>=6)&&
    Array.isArray(ad.pics)&&ad.pics.length&&ad.pics.every(u=>/^https:\/\/[a-z0-9.-]+\.divarcdn\.com\//.test(u));
}
const rows=Object.fromEntries(Object.entries(categories).map(([slug,name])=>[slug,{slug,name,...prior.categories.find(c=>c.slug===slug),ads:prior.ads.filter(a=>a.category===name&&eligible(a))}]));
const startedAt=now();
let finishedAt=prior.sourceStatus?.lastFinishedAt||null;
let hadFailures=false;
function writeSnapshot(){
  const status=Object.values(rows);
  const ads=[...new Map(status.flatMap(c=>c.ads).filter(a=>eligible(a)).map(a=>[a.id,a])).values()].sort((a,b)=>a.price-b.price);
  const partial=status.some(c=>c.coverage!=='complete-24h-source'||c.error);
  const checkedAt=status.every(c=>c.checkedAt)?Math.min(...status.map(c=>c.checkedAt)):null;
  let message='آخرین دریافت: '+(finishedAt?new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',dateStyle:'short',timeStyle:'short'}).format(finishedAt):'هنوز انجام نشده');
  if(partial)message+=' · پوشش محدود؛ همهٔ صفحات منبع بررسی نشده‌اند';
  if(status.some(c=>c.error))message+=' · دریافت بخشی از منبع ناموفق بود';
  const snapshot={ads,checkedAt,categories:status.map(({ads,...c})=>c),coverage:partial?'بخشی از آگهی‌های تازهٔ شش دسته؛ همهٔ صفحات منبع بررسی نشده‌اند':'همهٔ صفحات دسته‌های انتخاب‌شده',sourceStatus:{message,partial,updating:false,lastStartedAt:startedAt,lastFinishedAt:finishedAt,hosting:'GitHub Pages',updateEveryHours:4},qualityError:prior.qualityError||null};
  fs.writeFileSync(target,JSON.stringify(snapshot));
  return snapshot;
}
if(!process.argv.includes('--snapshot-only')){
  const maxPages=Number(process.env.MAX_PAGES||200);
  for(const [slug,name] of Object.entries(categories)){
    const old=rows[slug];
    const attempt=now();
    try{
      const result=await collectHtmlCategory(slug,old.ads,p=>console.log(JSON.stringify(p)),{maxPages});
      const complete=result.coverage==='complete-24h-source'&&!result.failures.length;
      const fresh=new Map((complete?[]:old.ads).filter(a=>eligible(a)).map(a=>[a.id,a]));
      for(const id of result.rejectedIds||[])fresh.delete(id);
      for(const ad of result.ads)if(eligible(ad))fresh.set(ad.id,ad);
      hadFailures ||= result.failures.length>0;
      rows[slug]={slug,name,ads:[...fresh.values()],checkedAt:complete?now():old.checkedAt||null,lastAttemptAt:attempt,lastFetchedAt:result.ads.length?now():old.lastFetchedAt||null,error:result.failures.length?'دریافت بعضی آگهی‌ها انجام نشد':null,coverage:result.coverage,scanned:result.scanned,pages:result.pages,hasMore:result.hasMore};
      console.log(JSON.stringify({slug,count:result.ads.length,coverage:result.coverage,failures:result.failures}));
    }catch(error){hadFailures=true;rows[slug]={...old,lastAttemptAt:attempt,error:'دریافت منبع انجام نشد',coverage:'source-unavailable'};console.error(slug+': '+error.message);}
    finishedAt=now();writeSnapshot();
  }
}
const result=writeSnapshot();
fs.mkdirSync(new URL('../docs/update-plan/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../docs/update-plan/index.html',import.meta.url),'<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>برنامهٔ دریافت آگهی</title><body><h1>برنامهٔ دریافت آگهی</h1><p>دریافت خودکار توسط GitHub Actions هر ۴ ساعت برای شش دستهٔ دیوار، فقط شهر تهران، کارکرده یا در حد نو، انتشار در ۲۴ ساعت اخیر، قیمت ۱ تا ۱۵ میلیون تومان، همهٔ عکس‌ها و فاصلهٔ هوایی تقریبی محله تا مترو هفت‌تیر. میز غذاخوری حداقل شش نفره. ممکن است منبع دریافت را محدود کند؛ پوشش و خطاها در api/listings.json ثبت می‌شود. دادهٔ معتبر پیشین فقط تا زمان انقضا حفظ می‌شود. زمان‌بندی GitHub ممکن است تأخیر داشته باشد. تگ کیفیت تنها با بررسی مستند عکس‌ها مجاز است.</p><p><a href="../">فهرست آگهی‌ها</a></p></body></html>');
console.log(JSON.stringify({ads:result.ads.length,partial:result.sourceStatus.partial,hadFailures}));
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'source_failed='+hadFailures+'\n');
