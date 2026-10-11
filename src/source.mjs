import fs from 'node:fs';
import {categories,extractState,parsePost,isTehranCityListing} from './divar.mjs';

export {categories};
const coordinates=JSON.parse(fs.readFileSync(new URL('./area_coordinates.json',import.meta.url),'utf8'));
const timeoutMs=20000;
let active=0;
const waiting=[];
let searchApiUnavailable=null;
let nextRequestAt=0;

async function request(url,options={}){
  if(active>=1)await new Promise(resolve=>waiting.push(resolve));
  else active++;
  try{
    const scheduled=Math.max(Date.now(),nextRequestAt);
    nextRequestAt=scheduled+2000;
    if(scheduled>Date.now())await new Promise(resolve=>setTimeout(resolve,scheduled-Date.now()));
    const response=await fetch(url,{...options,signal:AbortSignal.timeout(timeoutMs)});
    const content=await response.text();
    if(response.status===429)nextRequestAt=Math.max(nextRequestAt,Date.now()+Math.max(60000,Number(response.headers.get('retry-after')||0)*1000));
    return {ok:response.ok,status:response.status,headers:response.headers,text:async()=>content,json:async()=>JSON.parse(content)};
  }
  finally{const next=waiting.shift();if(next)next();else active--;}
}
const normalize=value=>String(value||'').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u200c\u200fـ]/g,'').replace(/\s+/g,' ').trim();
const beyondTehran=/(?:^|[^\p{L}\p{N}])(?:گرم\s*دره|صفا\s*دشت)(?=$|[^\p{L}\p{N}])/u;
const coffeeTable=/میز\s*وسط\s*مبل|میز\s*مبلی|میز\s*جلو|جلو\s*مبلی/u;
const sofaCover=/رو\s*مبلی/u;
const sofaCoverOnly=title=>sofaCover.test(title)&&!/مبل|کاناپه|آرمچیر|صندلی/u.test(title.replace(/رو\s*مبلی/gu,''));
const failureText=(label,error)=>label+': '+(error.cause?.code||error.message||String(error));

function normalizeDetail(raw,token){
  if(!Array.isArray(raw.sections)||!raw.seo?.web_info?.title||!raw.city)throw Error('Invalid public detail response');
  const sections=Object.fromEntries(raw.sections.map(s=>[s.section_name,(s.widgets||[]).map(w=>({dto:{widget_type:w.widget_type,data:w.data},widgetType:w.widget_type}))]));
  return {currentPost:{post:{...raw,city:{...raw.city,slug:raw.city.second_slug||raw.city.slug},seo:{...raw.seo,webInfo:raw.seo.web_info},sections,token,renderPostSuccess:true,loading:false}}};
}

function locationAllowed(post){
  const info=post.seo?.webInfo||{};
  const desc=(post.sections.DESCRIPTION||[]).filter(w=>w.dto?.widget_type==='DESCRIPTION_ROW').map(w=>w.dto.data.text||'').join('\n');
  const fields={cityId:String(post.city?.city_id||post.city?.id||''),citySlug:post.city?.slug,locationRuleVersion:1,area:info.district_persian,title:info.title,desc,districtSlug:post.webengage?.district||null};
  if(beyondTehran.test(normalize([fields.area,fields.title,fields.desc].join(' '))))return false;
  const districts=[];
  const visit=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(visit);return;}if(Array.isArray(v.districts?.repeated_string?.value))districts.push(...v.districts.repeated_string.value);Object.values(v).forEach(visit);};
  visit(post.sections);
  if(!isTehranCityListing(fields))return false;
  return districts.every(id=>isTehranCityListing({...fields,districtId:String(id)}));
}

function listBody(slug,pagination){
  return {source_view:'',disable_recommendation:false,map_state:{camera_info:{bbox:{}}},search_data:{form_data:{data:{recent_ads:{str:{value:'1d'}},category:{str:{value:slug}},price:{number_range:{minimum:'1000000',maximum:'15000000',value:{minimum:'1000000',maximum:'15000000'}}}}},server_payload:{'@type':'type.googleapis.com/widgets.SearchData.ServerPayload',additional_form_data:{data:{sort:{str:{value:'sort_date'}}}}},query:''},city_ids:['1'],previous_place_ids:[],user_selected_location:{},previous_user_selected_location:{},pagination_data:pagination};
}

function apiPage(raw,slug){
  if(Array.isArray(raw.list_widgets))return {rows:raw.list_widgets.map(w=>w.data||w.dto?.data).filter(w=>w?.token),hasMore:raw.pagination?.has_next_page===true,pagination:raw.pagination?.data};
  const info=raw.action_log?.server_side_info?.info;
  if(raw.list_widgets===undefined&&raw.pagination?.has_next_page!==true&&raw.pagination?.data?.last_post_date==='0001-01-01T00:00:00Z'&&Number.isInteger(raw.pagination?.data?.page)&&info?.['@type']==='type.googleapis.com/action_log.PostListLoadPageInfo'&&info?.jli?.category?.value===slug)return {rows:[],hasMore:false,pagination:raw.pagination.data};
  throw Error('Public search API format changed');
}

/** Public, anonymous source collection. Previous rows are always reverified. */
export async function collectHtmlCategory(slug,previous=[],onProgress,options={}){
  if(!categories[slug])throw Error('Invalid category');
  const maxPages=options.maxPages??2;
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>200)throw Error('Invalid source page limit');
  void previous;
  const startedAt=Date.now();
  const ads=new Map(),seen=new Set(),rejectedIds=new Set(),failures=[];
  let scanned=0,locationRejected=0,pages=0,detailFailed=false;
  let state;
  try{
    const response=await request('https://divar.ir/s/tehran/'+slug+'?price=1000000-15000000&recent_ads=1d',{headers:{Accept:'text/html','User-Agent':'Mozilla/5.0'}});
    if(!response.ok)throw Error('Public HTML search HTTP '+response.status);
    state=extractState(await response.text());
    if(!Array.isArray(state.nb?.listWidgets))throw Error('Public HTML search format changed');
  }catch(error){return {ads:[],rejectedIds:[],scanned:0,failures:[failureText('HTML search',error)],locationRejected:0,hasMore:true,checkedAt:new Date().toISOString(),coverage:'source-unavailable',pages:0,elapsedMs:Date.now()-startedAt,sourcePages:[]};}
  let page={rows:state.nb.listWidgets.map(w=>w.data?.dto?.data).filter(w=>w?.token),hasMore:state.nb.pagination?.hasMore===true,pagination:state.nb.pagination?.data};
  const reported=[];

  async function processRows(rows){
    const candidates=rows.filter(row=>['کارکرده','در حد نو'].includes(row.top_description_text)&&!seen.has(row.token));
    candidates.forEach(row=>seen.add(row.token));
    let next=0;
    await Promise.all(Array.from({length:Math.min(1,candidates.length)},async()=>{
      while(next<candidates.length&&!detailFailed){
        const row=candidates[next++];
        scanned++;
        try{
          const r=await request('https://api.divar.ir/v8/posts-v2/web/'+row.token,{headers:{Accept:'application/json-filled','X-Render-Type':'CSR','User-Agent':'Mozilla/5.0'}});
          if(r.status===404||r.status===410){rejectedIds.add(row.token);continue;}
          if(!r.ok)throw Error('HTTP '+r.status);
          const detail=normalizeDetail(await r.json(),row.token);
          const post=detail.currentPost.post;
          if(!locationAllowed(post)){locationRejected++;rejectedIds.add(row.token);continue;}
          if(slug==='furniture'&&(coffeeTable.test(normalize(post.seo.webInfo.title))||sofaCoverOnly(normalize(post.seo.webInfo.title)))){rejectedIds.add(row.token);continue;}
          const now=Date.now();
          const ad=parsePost(detail,slug,coordinates,now);
          if(ad&&ad.postedAt<=now&&ad.expiresAt>now&&ad.price>=1000000&&ad.price<=15000000&&ad.pics.length)ads.set(ad.id,ad);
          else rejectedIds.add(row.token);
        }catch(error){detailFailed=true;failures.push(failureText('Detail '+row.token,error));}
      }
    }));
  }

  while(true){
    await processRows(page.rows);
    pages++;
    reported.push({page:page.pagination?.page||pages,discovered:page.rows.length,scanned,accepted:ads.size,hasMore:page.hasMore});
    if(onProgress)await onProgress({category:slug,...reported.at(-1),failures:failures.length,locationRejected});
    if(detailFailed)break;
    if(!page.hasMore)break;
    if(Date.parse(page.pagination?.last_post_date)<=Date.now()-86400000){page.hasMore=false;break;}
    if(!page.pagination){failures.push('Public search pagination omitted cursor');break;}
    if(pages>=maxPages)break;
    if(searchApiUnavailable){failures.push('Search continuation unavailable: '+searchApiUnavailable);break;}
    try{
      const r=await request('https://api.divar.ir/v8/postlist/w/search',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','X-Standard-Divar-Error':'true','X-Render-Type':'CSR','User-Agent':'Mozilla/5.0'},body:JSON.stringify(listBody(slug,page.pagination))});
      if(!r.ok)throw Error('HTTP '+r.status);
      page=apiPage(await r.json(),slug);
    }catch(error){searchApiUnavailable=error.cause?.code||error.message;failures.push(failureText('Search continuation',error));break;}
  }
  const checkedAt=new Date().toISOString();
  const now=Date.now();
  const current=[...ads.values()].filter(ad=>ad.postedAt<=now&&ad.expiresAt>now);
  const hasMore=detailFailed||page.hasMore;
  const coverage=detailFailed?'partial-source-details':hasMore?(pages===1?'first-source-page':'partial-source-pages'):'complete-24h-source';
  return {ads:current,rejectedIds:[...rejectedIds],scanned,failures,locationRejected,hasMore,checkedAt,coverage,pages,elapsedMs:Date.now()-startedAt,sourcePages:reported};
}
