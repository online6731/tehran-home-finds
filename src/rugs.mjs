import {matchesAdultProduct} from './audience.mjs';
const normalize=value=>String(value||'').replace(/[۰-۹٠-٩]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.includes(c)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(c):'٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u200c\u200f]/g,' ').replace(/(\d)[/٫_،](\d)/g,'$1.$2').replace(/\s+/g,' ').trim();
const words={'یک':1,'دو':2,'سه':3,'چهار':4,'پنج':5,'شش':6,'هفت':7,'هشت':8,'نه':9,'دوازده':12};
const numbers=value=>normalize(value).replace(/(یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|دوازده)\s*(?=متر|در|[×x*])/gu,(_,word)=>words[word]);
const number='(\\d+(?:\\.\\d+)?)';
function nominalSize(value){
  const text=numbers(value);
  const match=text.match(new RegExp(number+'\\s*متر(?:ی|\\s*مربع)(?![\\p{L}])','u'));
  return match?Number(match[1]):null;
}
function measuredSize(value){
  const text=numbers(value).replace(/(\d+(?:\.\d+)?)\s*و\s*نیم/gu,(_,n)=>String(Number(n)+.5))
    .replace(/(\d+)\s*متر\s*و\s*(\d+)\s*(?:سانتی\s*متر|سانت|س)(?![\p{L}])/gu,(_,m,cm)=>String(Number(m)+Number(cm)/100)+' متر')
    .replace(/(\d+)\s*(?:سانت|س)(?![\p{L}])/gu,'$1 سانتی متر');
  const pair=text.match(new RegExp(number+'\\s*(?:متر|سانتی\\s*متر)?\\s*(?:در|×|x|\\*|به)\\s*'+number+'\\s*(?:متر|سانتی\\s*متر)?','iu'));
  if(pair){
    const a=Number(pair[1]),b=Number(pair[2]);
    // Persian listings often mix cm and m (e.g. 200 در 3).
    const cm=/سانتی\s*متر/u.test(pair[0]);
    return (a>20||cm&&a>=10?a/100:a)*(b>20||cm&&b>=10?b/100:b);
  }
  const length=text.match(new RegExp('طول\\s*'+number+'\\s*(سانتی\\s*متر|متر)','u'));
  const width=text.match(new RegExp('عرض\\s*'+number+'\\s*(سانتی\\s*متر|متر)','u'));
  return length&&width?Number(length[1])*(length[2].startsWith('سانتی')?.01:1)*Number(width[1])*(width[2].startsWith('سانتی')?.01:1):null;
}
export function adultRugInfo(title,desc='',fields={},photoAssessment=null){
  const name=normalize(title);
  if(!matchesAdultProduct(title,desc,fields,photoAssessment))return {accepted:false,reason:'child-or-teen-design'};
  if(/تابلو\s*فرش|پادری|رو\s*فرشی|فرش\s*راه\s*پله/u.test(name))return {accepted:false,reason:'not-floor-rug'};
  const field=fields['ابعاد']||String(desc).match(/ابعاد:\s*([^|\n]+)/u)?.[1]||'';
  // For runners, “4 metres” usually specifies length, not area. Require width.
  if(/کناره/u.test(name)){
    const runnerText=numbers(title+' '+desc);
    const width=runnerText.match(new RegExp('عرض\\s*'+number+'\\s*(سانتی\\s*متر|متر)?','u'));
    const length=runnerText.match(new RegExp(number+'\\s*متر(?:ی)?','u'));
    const widthInCm=width&&(width[2]?.startsWith('سانتی')||!width[2]&&Number(width[1])>20);
    const area=measuredSize(name)??(width&&length?Number(length[1])*Number(width[1])*(widthInCm?.01:1):measuredSize(field));
    return {accepted:Number.isFinite(area)&&area>=4,areaSquareMetres:area,sizeBasis:'runner-dimensions',reason:Number.isFinite(area)?area>=4?null:'under-four-square-metres':'size-unverified'};
  }
  // A bundle explicitly containing undersized rugs is outside the size rule.
  const titleSizes=[...numbers(title).matchAll(new RegExp(number+'\\s*متر(?:ی|\\s*مربع)(?![\\p{L}])','gu'))].map(m=>Number(m[1]));
  if(titleSizes.some(area=>area<4))return {accepted:false,reason:'under-four-square-metres'};
  // Divar's standard 4/6/9/12 metre sizes are nominal area classes.
  // Do not reinterpret their parenthesized standard dimensions as a conflict.
  // Explicit seller measurements override nominal labels; omit copied form text.
  const sellerDesc=String(desc).split('\n').filter(line=>!/ابعاد:/u.test(line)).join(' ');
  const sellerSizes=[...numbers(sellerDesc).matchAll(new RegExp(number+'\\s*متر(?:ی|\\s*مربع)(?![\\p{L}])','gu'))].map(m=>Number(m[1]));
  if(sellerSizes.some(area=>area<4))return {accepted:false,reason:'under-four-square-metres'};
  const measuredArea=measuredSize(name)??measuredSize(sellerDesc);
  if(measuredArea!==null&&measuredArea<4)return {accepted:false,areaSquareMetres:measuredArea,sizeBasis:'seller-dimensions',reason:'under-four-square-metres'};
  const titleArea=nominalSize(name)??measuredSize(name);
  const fieldArea=nominalSize(field)??measuredSize(field);
  if(titleArea!==null&&titleArea<4||fieldArea!==null&&fieldArea<4)return {accepted:false,reason:'under-four-square-metres'};
  const area=titleArea??fieldArea??measuredSize(desc)??(!/کناره/u.test(name)?nominalSize(desc):null);
  return {accepted:Number.isFinite(area)&&area>=4,areaSquareMetres:area,sizeBasis:titleArea!==null?'title':fieldArea!==null?'divar-dimensions':'description',reason:Number.isFinite(area)?area>=4?null:'under-four-square-metres':'size-unverified'};
}
export const matchesAdultRug=(...args)=>adultRugInfo(...args).accepted;
