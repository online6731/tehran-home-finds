// Slugs verified against Divar's public Tehran category tree on 2026-10-11.
// Cooking is a broad source category; only tabletop gas hobs are accepted.
export const applianceCategories = {
  'oven-baking-appliances':'گاز رومیزی',
  'refrigerator-freezer':'یخچال و فریزر',
  'washing-machines':'ماشین لباسشویی',
  dishwasher:'ماشین ظرف‌شویی',
  'vacuums-cleaner':'جاروبرقی'
};

const normalize=value=>String(value||'').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u200c\u200fـ\u064b-\u065f]/g,'').replace(/\s+/g,' ').trim();
const buyers=/خریدار|خریداری\s*می|(?:^|\s)می\s*خر[یم]|(?:^|\s)خرید\s*(?:انواع|یخچال|فریزر|لباس\s*شویی|ظرف\s*شویی|جارو|گاز)/u;
const services=/تعمیر\s*(?:کار|ات|گاه)|(?:^|\s)(?:تعمیر|سرویس|نصب|شارژ\s*گاز)\s*(?:انواع|یخچال|فریزر|لباس\s*شویی|ظرف\s*شویی|جارو|گاز)|(?:^|\s)خدمات\s/u;
const parts=/قطعات?|لوازم\s*یدکی|کارتن|بسته\s*بندی|کمپرسور|موتور|دینام|برد|پمپ|المنت|خازن|ترموستات|شیلنگ|لوله|واشر|دستگیره|لولای?|سینی|ولوم|نازل|کیسه|پاکت|فیلتر|باتری|کاور|روکش|بدنه|(?:شیشه|چدن|سر\s*شعله)\s*(?:اجاق\s*)?گاز|(?:^|\s)درب\s*(?:یخچال|فریزر|لباس\s*شویی|ظرف\s*شویی)/u;
const incomplete=/بدون\s*(?:موتور|کمپرسور|برد)|اوراقی|اسقاطی|سوخته|خراب|معیوب|نیازمند\s*تعمیر|برای\s*قطعات/u;
const commercial=/صنعتی|رستورانی|قنادی|فروشگاهی|ویترینی|ایستاده\s*ویترینی|گل\s*فروشی/u;

/** True only for a complete appliance matching the requested subtype.
 * Fields are actual public form values, never inferred from a brand name.
 * The function also accepts saved rows' productFields for expiry/merge gates.
 */
export function matchesAppliance(slug,title,values={},desc=''){
  if(!Object.hasOwn(applianceCategories,slug))return true;
  const name=normalize(title),description=normalize(desc);
  const fields=Object.fromEntries(Object.entries(values||{}).map(([k,v])=>[normalize(k),normalize(v)]));
  const type=[fields['نوع کالا'],fields['نوع دستگاه'],fields['نوع گاز'],fields['نوع اجاق گاز']].filter(Boolean).join(' ');
  // Product titles mentioning accessories, buying, services or broken items
  // are excluded; descriptions may legitimately mention prior maintenance.
  if(buyers.test(name)||services.test(name)||parts.test(name)||incomplete.test(name)||commercial.test(name))return false;
  // "خریدار واقعی تماس بگیرد" is normal seller wording, so description
  // buyer detection requires an explicit advertisement beginning.
  if(/^(?:خریدار\s*(?:انواع|یخچال|فریزر|لباس\s*شویی|ظرف\s*شویی|جارو|گاز)|تعمیرات|تعمیرکار|خدمات\s*تعمیر)/u.test(description))return false;
  if(parts.test(type)||commercial.test(type))return false;

  if(slug==='oven-baking-appliances'){
    if(/ایستاده|فردار|فر\s*دار|طرح\s*فر|پیک\s*نیک|پلو\s*پز|منقل|کباب\s*پز|سرخ\s*کن|توستر|مایکرو|مایکروویو|سولاردام/u.test(name))return false;
    const energy=Object.entries(fields).filter(([k])=>/نوع انرژی/u.test(k)).map(([,v])=>v).join(' ');
    if(energy&&!/گاز/u.test(energy))return false;
    const gas=/گاز/u.test(name+' '+type+' '+energy);
    const hob=/رو\s*میزی|صفحه\s*ای|تو\s*کار/u.test(name+' '+type);
    // Keep the descriptor near "gas" so a generic metadata key such as
    // "نوع انرژی (اجاق/فر توکار)" cannot turn a standing stove into a hob.
    const describedHob=/گاز\s*(?:[\p{L}\p{N}-]+\s*){0,2}(?:رو\s*میزی|صفحه\s*ای|تو\s*کار)|(?:رو\s*میزی|صفحه\s*ای|تو\s*کار)\s*(?:[\p{L}\p{N}-]+\s*){0,2}گاز/u.test(description);
    return gas&&(hob||describedHob);
  }
  if(slug==='refrigerator-freezer')return /یخچال|فریزر/u.test(name+' '+type);
  if(slug==='washing-machines')return /لباس\s*شویی|کهنه\s*شور|بچه\s*شور|مینی\s*واش|خشک\s*کن\s*لباس/u.test(name+' '+type);
  if(slug==='dishwasher')return /ظرف\s*شویی/u.test(name+' '+type);
  return /جارو\s*برقی|جارو\s*شارژی|جارو\s*رباتیک/u.test(name+' '+type);
}
