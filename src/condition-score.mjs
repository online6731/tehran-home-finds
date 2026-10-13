// An indicative condition index, never a technical inspection or real wear percentage.
// Only fingerprint-matched photo reviews are counted as observed image evidence.
const normalize=s=>String(s||'').replace(/\u200c/g,' ').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/\s+/g,' ');
export function conditionScore(ad){
  const text=normalize(ad.desc),review=ad.quality?.method==='photos-and-description'?ad.quality:null;
  const primary=ad.photoAssessment?.method==='primary-photo'?ad.photoAssessment:null;
  // Exclude explicit denials before looking for defects, keeping nearby positive
  // statements (e.g. "بدون شکستگی ولی موتور خراب") available to the matcher.
  const defectText=text
    .replace(/(?:بدون|فاقد)\s*(?:هیچ\s*)?(?:نیاز\s*به\s*(?:تعمیر|تعویض|شستشو)|پارگی|شکستگی|سوختگی|افت|نشست|خط\s*و\s*خش)/gu,' ')
    .replace(/(?:ابر|نشیمن|تشک).{0,12}?(?:نخوابیده|خوابیده\s*نیست)/gu,' ')
    .replace(/(?:پارگی|شکستگی|سوختگی|مشکل|نشست)\s*(?:نداره|ندارد|نیست)/gu,' ')
    .replace(/نیاز\s*به\s*(?:تعمیر|تعویض|شستشو)\s*(?:نداره|ندارد|نیست)/gu,' ');
  let score=ad.condition==='در حد نو'?76:60;
  const reasons=[ad.condition==='در حد نو'?'فروشنده وضعیت را «در حد نو» انتخاب کرده است.':'فروشنده وضعیت را «کارکرده» انتخاب کرده است.'];
  const defects=[
    [/کار\s*نمی\s*کن|گازش?\s*خالی|موتور\s*(?:سوخته|خراب)|مشکل\s*داره|نیاز\s*به\s*(?:تعمیر|تعویض)|نیازمند\s*تعمیر/u,30,'در توضیحات، خرابی یا نیاز به تعمیر/تعویض ذکر شده است.'],
    [/(?:داره|دارد|شده).{0,12}(?:پارگی|شکستگی)|(?:شکسته|پاره\s*شده|سوختگی\s*(?:کوچک|داره)|پارگی\s*کوچیک|شکستگی.{0,18}دارد)/u,20,'در توضیحات، آسیب ظاهری یا شکستگی ذکر شده است.'],
    [/ابر.{0,12}خوابیده|نشیمن.{0,12}خوابیده|تشک.{0,12}خوابیده|نشست\s*داره/u,18,'فروشنده از افت نشیمن یا تشک گفته است.'],
    [/نیاز\s*به\s*شستشو|کثیف\s*هست|رنگ\s*بدنه.{0,12}رفته|چسب\s*ریخته|نم.{0,12}خراب/u,12,'تمیزکاری یا ترمیم سطحی در توضیحات مطرح شده است.'],
  ];
  const hasDefect=defects.some(([p])=>p.test(defectText));
  for(const [pattern,penalty,reason] of defects)if(pattern.test(defectText)){score-=penalty;reasons.push(reason);}
  if(!hasDefect&&/بدون\s*(?:پارگی|شکستگی|خط\s*و\s*خش)|بسیار\s*تمیز|کم\s*کارکرد/u.test(text)){score+=4;reasons.push('توضیحات فروشنده به تمیزی یا نبود آسیب اشاره می‌کند؛ این ادعا تأیید فنی نیست.');}
  if(review){
    if(review.verdict==='promising')score=hasDefect?Math.min(score,70):Math.min(88,Math.max(score,82));
    if(review.verdict==='caution')score=Math.min(score,55);
    reasons.push(...review.observations.slice(0,2));
  }
  else if(primary){
    score=Math.round(score*.4+primary.appearanceScore*.6);
    if(hasDefect)score=Math.min(score,60);
    if(primary.limitedEvidence)score=Math.min(score,60);
    reasons.push(...primary.observations);
  }
  score=Math.max(15,Math.min(88,score));
  return {version:2,score,outOf:100,distanceFromNew:100-score,method:review?'reviewed-photos-and-description':primary?'primary-photo-and-description':'seller-description-only',confidence:review?'متوسط':'کم',reviewedPhotoCount:review?.photoCount||primary?.photoCount||0,label:score>=80?'ظاهر نزدیک‌تر به نو':score>=65?'ظاهر قابل‌قبول':score>=50?'کارکرده؛ نیازمند بازدید':'نیازمند بررسی جدی',reasons,limitations:['امتیاز تخمینی است؛ شاخص فاصله با نو درصد واقعی فرسودگی نیست.',...(review?[]:primary?['فقط عکس اصلی در نمای کلی بررسی شده؛ کل گالری و جزئیات نزدیک بررسی نشده‌اند.']:['عکس‌های این محصول هنوز ارزیابی نشده‌اند؛ امتیاز فعلی فقط از توضیحات و وضعیت اعلامی است.']),'سلامت فنی، دوام و ارزش خرید تنها با بازدید و تست مشخص می‌شوند.']};
}
