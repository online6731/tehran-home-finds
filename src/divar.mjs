import {applianceCategories,matchesAppliance} from './appliances.mjs';
export {applianceCategories,matchesAppliance} from './appliances.mjs';
export const categories = {
  furniture:'مبل و کاناپه', 'dining-table':'میز غذاخوری', 'bed-service':'تخت و سرویس خواب',
  'shoe-rack-drawer':'کمد و جاکفشی', carpet:'فرش', 'rugs-woolen-cloth':'گلیم و جاجیم',
  ...applianceCategories
};
const digits=s=>String(s||'').replace(/[۰-۹٠-٩]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.includes(c)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(c):'٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
export function extractState(html){
  const m=html.match(/window\.__PRELOADED_STATE__\s*=\s*([\s\S]*?)\s*<\/script>/);
  if(!m)throw Error('Divar did not return listing data');
  return JSON.parse(m[1].trim().replace(/;$/,''));
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function source(url){
  // Divar's server-rendered HTML can intermittently be only a shell (HTTP 200
  // with an empty currentPost).  The public client API used by the site itself
  // is stable and does not require a login for public ads, so prefer it for
  // detail pages and keep HTML as a compatibility fallback.
  const tokenMatch=url.match(/\/v\/[^/]+\/([A-Za-z0-9_-]+)/);
  if(tokenMatch){
    for(let attempt=0;attempt<3;attempt++)try{
      const r=await fetch('https://api.divar.ir/v8/posts-v2/web/'+tokenMatch[1],{headers:{Accept:'application/json-filled','X-Render-Type':'CSR','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(25000)});
      if(r.status===404||r.status===410)return {removed:true};
      if((r.status===429||r.status>=500)&&attempt<2){await r.text();await pause(2000*(attempt+1));continue;}
      if(r.ok){
        const raw=await r.json();
        if(!Array.isArray(raw.sections)||!raw.seo?.web_info?.title||!raw.city)throw Error('Invalid Divar detail API response');
        const sections=Object.fromEntries((raw.sections||[]).map(s=>[s.section_name,(s.widgets||[]).map(w=>({dto:{widget_type:w.widget_type,data:w.data},widgetType:w.widget_type}))]));
        const post={...raw,city:{...raw.city,slug:raw.city?.second_slug||raw.city?.slug},seo:{...raw.seo,webInfo:raw.seo?.web_info||raw.seo?.webInfo},sections,token:tokenMatch[1]};
        return {currentPost:{post:{...post,renderPostSuccess:true,loading:false}},httpError:{is404:false,is410:false}};
      }
    }catch{if(attempt<2)await pause(1000*(attempt+1));}
  }
  for(let attempt=0;attempt<3;attempt++){
    const r=await fetch(url,{headers:{Accept:'text/html','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(25000)});
    if(r.status===404||r.status===410)return {removed:true};
    if((r.status===429||r.status>=500)&&attempt<2){
      await r.text();await pause(Math.min(10000,Math.max(3000,Number(r.headers.get('retry-after')||3)*1000)));continue;
    }
    if(!r.ok)throw Error('Divar HTTP '+r.status);
    const html=await r.text();
    const state=extractState(html);
    state.sourceLinks=Object.fromEntries([...html.matchAll(/href="(\/v\/[^"\s]+\/([a-zA-Z0-9_-]+))"/g)].map(m=>[m[2],'https://divar.ir'+m[1]]));
    if(url.includes('/v/')&&!state.currentPost?.post?.token){
      if(state.httpError?.is404||state.httpError?.is410)return {removed:true};
      if(attempt<2){await pause(3000);continue;}
      throw Error('Divar returned a page without detail data: '+url);
    }
    return state;
  }
}

async function listApi(slug,pagination){
  const data={
    source_view:'',disable_recommendation:false,
    map_state:{camera_info:{bbox:{}}},
      search_data:{form_data:{data:{recent_ads:{str:{value:'1d'}},category:{str:{value:slug}},price:{number_range:{minimum:'1000000',maximum:'15000000',value:{minimum:'1000000',maximum:'15000000'}}}}},server_payload:{'@type':'type.googleapis.com/widgets.SearchData.ServerPayload',additional_form_data:{data:{sort:{str:{value:'sort_date'}}}}},query:''},
    city_ids:['1'],previous_place_ids:[],user_selected_location:{},previous_user_selected_location:{}
  };
  if(pagination)data.pagination_data=pagination;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch('https://api.divar.ir/v8/postlist/w/search',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','X-Standard-Divar-Error':'true','X-Render-Type':'CSR','User-Agent':'Mozilla/5.0'},body:JSON.stringify(data),signal:AbortSignal.timeout(25000)});
      if((r.status===429||r.status>=500)&&attempt<2){await r.text();await pause(Math.min(10000,Math.max(1500,Number(r.headers.get('retry-after')||2)*1000)));continue;}
      if(!r.ok)throw Error('Divar list API HTTP '+r.status);
      return r.json();
    }catch(e){if(attempt<2){await pause(1000*(attempt+1));continue;}throw e;}
  }
}
const months=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const persian=new Intl.DateTimeFormat('en-u-ca-persian',{timeZone:'UTC',year:'numeric',month:'numeric',day:'numeric'});
const dates=new Map();
function jalaliDate(y,m,d){
  const key=`${y}-${m}-${d}`;
  if(dates.has(key))return dates.get(key);
  let low=Date.UTC(y+621,2,15)/86400000,high=low+375;
  const target=y*10000+m*100+d;
  while(low<=high){
    const mid=Math.floor((low+high)/2),parts=Object.fromEntries(persian.formatToParts(new Date(mid*86400000)).map(p=>[p.type,p.value]));
    const v=Number(parts.year)*10000+Number(parts.month)*100+Number(parts.day);
    if(v===target){dates.set(key,mid*86400000);return mid*86400000;}
    if(v<target)low=mid+1;else high=mid-1;
  }
  return null;
}
export function publishedAt(section,now=Date.now()){
  const s=digits(JSON.stringify(section));
  const m=s.match(/انتشار آگهی:\s*(\d+)\s+(\S+)\s+(\d+)،\s*(\d+):(\d+)/);
  if(m){const date=jalaliDate(+m[3],months.indexOf(m[2])+1,+m[1]);return date===null?null:date+(+m[4]*60+ +m[5]-210)*60000;}
  // Only a conservative bound is accepted if Divar omits the absolute publication field.
  const title=section.find(w=>w.dto?.widget_type==='EXPANDABLE_SECTION')?.dto.data.title||'';
  const age=digits(title.split(' در ')[0]);
  if(/روز|دیروز|هفته|ماه/.test(age))return null;
  const n=+(age.match(/\d+/)||[])[0];
  if(/ساعت/.test(age)&&Number.isFinite(n))return now-(n+1)*3600000;
  if(/دقیقه/.test(age)&&Number.isFinite(n))return now-(n+1)*60000;
  if(/لحظه/.test(age))return now-60000;
  return null;
}
function distance(area,points){
  const p=points[area];
  if(!p||!['administrative','neighbourhood','suburb','locality'].includes(p.type))return null;
  const rad=n=>n*Math.PI/180,lat=rad(p.lat),st=rad(35.7155645),dl=rad(p.lon-51.4260941);
  const a=Math.sin((lat-st)/2)**2+Math.cos(lat)*Math.cos(st)*Math.sin(dl/2)**2;
  return Math.round(2*6371.0088*Math.asin(Math.sqrt(a))*2)/2;
}

// Divar's city field is useful for selecting Tehran, but it also covers
// municipalities that share Tehran's city id (notably Rey). Keep a second,
// conservative text gate so the catalogue contains items physically inside
// the city. We intentionally do not reject «اندیشه» by itself: labels such as
// «جوانمردان (اندیشه)» are used for a Tehran neighbourhood.
const outsideTehran = /(?:^|[^\p{L}\p{N}])(?:شهر\s*ری|اسلام\s*شهر|واوان|پردیس|بومهن|رودهن|دماوند|شهریار|ملارد|کرج|فردیس|ورامین|قرچک|پاکدشت|رباط\s*کریم|پرند|قیام\s*دشت|حسن\s*آباد\s*فشافویه|لواسان|فشم|نسیم\s*شهر|باقرشهر|کهریزک|شاهدشهر|چهاردانگه|شهر\s*(?:قدس|اندیشه))(?=$|[^\p{L}\p{N}])/u;
// IDs observed in the public detail responses used by this updater. Keep the
// list evidence-backed: unknown IDs are left to the explicit text gate below
// rather than risking exclusion of a Tehran neighbourhood.
const reyDistrictIds = new Set(['4042','4043','4044','4045','4047','4049','4051','4052','4055','4056','4220','4221','4223','4224','4226','4232']);
const reyAreas = new Set(['جوانمرد قصاب','دولت آباد (شهرری)','دولت‌آباد','فیروزآبادی','صفاییه (چشمه علی)','ظهیرآباد','منصوریه منگل','شهادت','دیلمان','امین آباد','علایین','حمزه‌آباد','سیزده آبان'].map(locationText));
function locationText(value){
  return String(value||'').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u200c\u200f]/g,'').replace(/[ـ]/g,'').replace(/\s+/g,' ').trim();
}
export function isTehranCityListing(ad){
  if(ad?.cityId!=='1'||ad?.citySlug!=='tehran'||ad?.locationRuleVersion!==1)return false;
  if(reyDistrictIds.has(String(ad.districtId||''))||/-rey$/i.test(String(ad.districtSlug||'')))return false;
  const area=locationText(ad.area);
  if(!area||area==='نامشخص'||reyAreas.has(area))return false;
  return !outsideTehran.test(locationText([area,ad.title,ad.desc].join(' ')));
}
function districtEvidence(p){
  const found=[];
  const visit=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){for(const x of v)visit(x);return;}const d=v.districts?.repeated_string?.value;if(Array.isArray(d))found.push(...d);for(const x of Object.values(v))visit(x);};
  visit(p.sections);
  const districtId=found.map(String).find(id=>reyDistrictIds.has(id))||found.map(String)[0]||null;
  return {districtId,districtSlug:p.webengage?.district||null};
}
function locationEvidence(p){
  return {cityId:String(p.city?.city_id||p.city?.id||''),citySlug:p.city?.slug||p.city?.second_slug,locationRuleVersion:1,...districtEvidence(p)};
}
function postLocation(p){
  return {...locationEvidence(p),area:p.seo?.webInfo?.district_persian||'نامشخص',title:p.seo?.webInfo?.title||'',desc:(p.sections?.DESCRIPTION||[]).filter(w=>w.dto?.widget_type==='DESCRIPTION_ROW').map(w=>w.dto.data.text||'').join('\n')};
}
export function parsePost(state,slug,points,now=Date.now()){
  const p=state.currentPost?.post;
  if(!p||p.city?.slug!=='tehran')return null;
  const sections=p.sections||{},values={};
  // Appliance subtype/energy/capacity fields also live inside a public
  // SELECTOR_ROW's feature modal. Read both layouts without losing labels.
  const readFields=widgets=>{for(const w of widgets||[]){const d=w.dto?.data||w.data;if(!d)continue;if(typeof d.title==='string'&&typeof d.value==='string')values[d.title]=d.value;readFields(d.action?.payload?.modal_page?.widget_list);readFields(d.action?.payload?.modalPage?.widgetList);}};
  readFields(sections.LIST_DATA);
  const condition=values['وضعیت'];
  if(!['کارکرده','در حد نو'].includes(condition))return null;
  const price=Number(digits(values['قیمت']).replace(/[^0-9]/g,''));
  if(price<1000000||price>15000000)return null;
  const posted=publishedAt(sections.TITLE||[],now);
  if(!posted||posted<=now-86400000||posted>now+300000)return null;
  const title=p.seo?.webInfo?.title||'',area=p.seo?.webInfo?.district_persian||'نامشخص';
  const desc=(sections.DESCRIPTION||[]).filter(w=>w.dto?.widget_type==='DESCRIPTION_ROW').map(w=>w.dto.data.text||'').join('\n');
  if(!matchesAppliance(slug,title,values,desc))return null;
  if(!isTehranCityListing({...locationEvidence(p),area,title,desc}))return null;
  let seats=+(digits(values['تعداد نشیمن']||title).match(/(\d+)\s*نفر/)||[])[1]||0;
  if(!seats){const words={'یک':1,'دو':2,'سه':3,'چهار':4,'شش':6,'هفت':7,'هشت':8,'نه':9};seats=Object.entries(words).find(([k])=>new RegExp(k+'\\s*نفره').test(title))?.[1]||0;}
  if(slug==='dining-table'&&seats<6)return null;
  if(slug==='furniture'&&!/مبل|کاناپه|آرمچیر|صندلی/.test(title))return null;
  if(slug==='furniture'&&/کاور|روکش|شستشو|تعمیر|جلومبلی|جلو مبلی|میز عسلی/.test(title)&&!/مبل|کاناپه|آرمچیر|صندلی/.test(title.replace(/جلومبلی|جلو مبلی|رو مبلی|میز عسلی/g,'')))return null;
  if(slug==='bed-service'&&!/تخت|سرویس خواب/.test(title))return null;
  const pics=[...new Set((sections.IMAGE||[]).flatMap(w=>(w.dto?.data.items||[]).map(i=>i.image?.url||i.image_url)).filter(u=>/^https:\/\/[a-z0-9.-]+\.divarcdn\.com\//.test(u)))];
  if(!pics.length)return null;
  const timeTitle=(sections.TITLE||[]).find(w=>w.dto?.widget_type==='EXPANDABLE_SECTION')?.dto.data.title||'';
  const productFields=Object.fromEntries(['نوع کالا','نوع دستگاه','نوع گاز','نوع اجاق گاز','سازنده','برند','ظرفیت','نوع مخزن','جنس صفحه','نوع انرژی (اجاق/فر توکار)','نوع انرژی','تعداد شعله','رنگ'].filter(k=>values[k]).map(k=>[k,values[k]]));
  const features=['بافت','ابعاد','نوع کالا','رنگ زمینه',...(Object.hasOwn(applianceCategories,slug)?['نوع دستگاه','سازنده','برند','ظرفیت','نوع مخزن','جنس صفحه','نوع انرژی (اجاق/فر توکار)','تعداد شعله','رنگ']:[])].filter(k=>values[k]).map(k=>k+': '+values[k]);
  const chairs=/بدون صندلی|فقط (خود )?میز/.test(title+' '+desc)?'بدون صندلی':(/با\s*صندلی|همراه صندلی|\d+\s*(عدد )?صندلی/.test(digits(title+' '+desc))?'همراه صندلی':'نامشخص');
  return {id:p.token,url:'https://divar.ir/v/'+encodeURIComponent(title.replace(/\s+/g,'-'))+'/'+p.token,title,price,area,condition,seats:slug==='furniture'||slug==='dining-table'?seats:0,category:categories[slug],kind:slug==='shoe-rack-drawer'||Object.hasOwn(applianceCategories,slug)?(values['نوع دستگاه']||values['نوع کالا']||''):'',...(Object.hasOwn(applianceCategories,slug)?{productFields}:{}),chairs,desc:features.join(' | ')+(features.length?'\n':'')+desc,issues:[],pics,distanceKm:distance(area,points),age:timeTitle.split(' در ')[0],postedAt:posted,expiresAt:posted+86400000,verifiedAt:now,checkedAt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tehran',dateStyle:'short',timeStyle:'short'}).format(now),...locationEvidence(p)};
}
export async function collectCategory(slug,points,cursor,cached=[]){
  if(!categories[slug])throw Error('Invalid category');
  let pagination;
  if(cursor){try{pagination=JSON.parse(atob(cursor));}catch{throw Error('Invalid refresh cursor');}if(!pagination||!Number.isInteger(pagination.page)||pagination.page<1||pagination.page>200)throw Error('Invalid refresh page');}
  const apiList=await listApi(slug,pagination);
  let widgets;
  if(Array.isArray(apiList.list_widgets)){
    widgets=apiList.list_widgets;
  }else{
    // The public protobuf JSON omits empty repeated fields on the terminal
    // page. Accept only Divar's validated empty-search envelope; arbitrary
    // missing or malformed list_widgets responses remain hard failures.
    const info=apiList.action_log?.server_side_info?.info;
    const terminalEmpty=apiList.list_widgets===undefined &&
      apiList.pagination?.has_next_page!==true &&
      apiList.pagination?.data?.last_post_date==='0001-01-01T00:00:00Z' &&
      Number.isInteger(apiList.pagination?.data?.page) &&
      info?.['@type']==='type.googleapis.com/action_log.PostListLoadPageInfo' &&
      info?.jli?.category?.value===slug;
    if(!terminalEmpty)throw Error('Divar listing API format changed');
    widgets=[];
  }
  const rows=widgets.map(w=>w.data||w.dto?.data).filter(w=>w?.token&&['کارکرده','در حد نو'].includes(w.top_description_text));
  const ids=[...new Set(rows.map(w=>w.token))];
  const ads=[],rejectedIds=[];let verified=0,unavailable=0,locationRejected=0;const failures=[];
  for(const id of ids){
    const recent=cached.find(a=>a.id===id&&isTehranCityListing(a)&&a.price>=1000000&&a.price<=15000000&&a.verifiedAt>Date.now()-25*60000&&a.expiresAt>Date.now());
    if(recent){ads.push(recent);verified++;continue;}
    await pause(500);
    const row=rows.find(w=>w.token===id);
    let post;
    try{post=await source('https://divar.ir/v/'+encodeURIComponent(row.title.replace(/\s+/g,'-'))+'/'+id);}
    catch(e){failures.push(e.message);continue;}
    if(!post){unavailable++;continue;}
    if(post.removed){rejectedIds.push(id);continue;}
    if(!post.currentPost?.post?.token){unavailable++;continue;}
    verified++;
    if(!isTehranCityListing(postLocation(post.currentPost.post)))locationRejected++;
    const ad=parsePost(post,slug,points);if(ad)ads.push(ad);else rejectedIds.push(id);
  }
  if(ids.length&&(verified+rejectedIds.length===0||unavailable+failures.length>ids.length/2))throw Error('Most details could not be verified; source format or access may have changed');
  const hasMore=!!apiList.pagination?.has_next_page&&Date.parse(apiList.pagination.data?.last_post_date)>Date.now()-86400000;
  const nextCursor=hasMore?btoa(JSON.stringify(apiList.pagination.data)):null;
  return {ads,rejectedIds,scanned:ids.length,unavailable,failures,locationRejected,hasMore,nextCursor,page:apiList.pagination?.data?.page||1};
}
