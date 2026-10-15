const normalize=value=>String(value||'').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u200c\u200e\u200fـ]/g,' ').replace(/\s+/g,' ').trim();
// Apply this across all categories, including mixed bundles and appliances.
// Do not match "به کارتون میاد" or "مهدیه": neither identifies a child product.
const childAudience=/کودک|نو\s*جوان|نوزاد|سیسمونی|سیس\s*مونی|بچگانه|بچه\s*گانه|دخترانه|پسرانه|مهد\s*کودک|خردسال|طفل|بچه(?=$|[^\p{Script=Arabic}])|(?:اتاق|مخصوص|مناسب|برای|لباس)\s*(?:دختر|پسر)(?:\s|$)/u;
const childDesign=/عروسکی|کارتونی|طرح\s*(?:کارتون|انیمیشن|ماشین(?:\s|$)|حیوانات\s*کارتونی)|(?:هلو\s*)?کیتی|میکی\s*(?:موس)?|مینی\s*موس|مینیون|باب\s*اسفنجی|السا|فروزن|توییتی|تویتی|اسپایدر(?:من)?|مرد\s*عنکبوتی|بتمن|بن\s*تن|مک\s*کوئین|مکویین|(?:توم|تام)\s*و\s*جری|پرنسس|شاهزاده\s*خانم|اسنوپی|پو\s*خرسه|شرک(?![\p{L}])|بره\s*ناقلا|پاو\s*پاترول|سگ\s*های\s*نگهبان/u;
export function matchesAdultProduct(title,desc='',fields={},photoAssessment=null){
  const text=normalize([title,desc,...Object.values(fields||{})].join(' '));
  return !childAudience.test(text)&&!childDesign.test(text)&&!['child','teen'].includes(photoAssessment?.audience);
}
