import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesDoubleBed,matchesDiningTable} from '../src/divar.mjs';
import {matchesAppliance} from '../src/appliances.mjs';
import {conditionScore} from '../src/condition-score.mjs';
import {listingDistance,sourceMapPoint} from '../src/locations.mjs';
import {attachPhotoAssessment} from '../src/photo-assessment.mjs';
import {reviewFingerprint} from '../src/quality.mjs';
test('Clean chairs and refrigerator stands are not complete requested products',()=>{
  assert(!matchesDiningTable('صندلی ناهارخوری','۶عدد سالم وتمیز درحد نو',6));
  assert(matchesDiningTable('میز ناهارخوری','شش نفره سالم و تمیز',6));
  assert(!matchesAppliance('refrigerator-freezer','وسایل یخچال',{},'زیر یخچالی سالم'));
  assert(matchesAppliance('refrigerator-freezer','یخچال فریزر',{},'همراه وسایل یخچال'));
  assert(!matchesAppliance('dishwasher','لوازم ماشین ظرفشویی موریس لوازم',{},'تمامی لوازم موجود است فقط لوازم'));
  assert(!matchesAppliance('dishwasher','ماشین ظرفشویی',{},'فقط لوازم'));
});
test('Only double beds enter the catalog even when a source form is mislabelled',()=>{
  assert(matchesDoubleBed('تخت دونفره','نوع کالا: تخت دو نفره'));
  assert(matchesDoubleBed('سرویس خواب','',{'نوع کالا':'سرویس خواب دو نفره'}));
  for(const title of ['تخت نوجوان دو نفره','تخت ۱/۵نفره','تخت ۱_۵نفره','تخت دو طبقه','تخت یک نفره','دو عدد تخت تک نفره','تخت کودک','کاناپه تختخوابشو','تخت یک و دونفره','تخت چوبی چهار نفره'])assert(!matchesDoubleBed(title,'نوع کالا: تخت دو نفره'),title);
  assert(!matchesDoubleBed('تخت خواب',''));
  assert(matchesDoubleBed('تخت خواب','نوع کالا: تخت دو نفره'));
});
test('Explicit denials do not reduce condition scores, but nearby defects still do',()=>{
  const ad={condition:'در حد نو',desc:''},base=conditionScore(ad).score;
  for(const desc of ['اصلا ابرها نخوابیده','نشیمن خوابیده نیست','بدون نیاز به تعمیر','نیاز به تعمیر ندارد','شکستگی ندارد'])assert(conditionScore({...ad,desc}).score>=base,desc);
  assert(conditionScore({...ad,desc:'بدون شکستگی ولی موتور خراب است'}).score<base);
});
test('Scores separate uninspected photos and technical defects from observed appearance',()=>{
  const base={condition:'در حد نو',desc:'سالم',pics:['one','two']};
  const initial=conditionScore(base);assert.equal(initial.method,'seller-description-only');assert.equal(initial.reviewedPhotoCount,0);assert.equal(initial.distanceFromNew,100-initial.score);
  const broken=conditionScore({...base,desc:'دو شعله کار نمیکنه نیاز به تعمیر دارد'});assert(broken.score<initial.score);
  const reviewed=conditionScore({...base,quality:{method:'photos-and-description',verdict:'promising',photoCount:2,observations:['بدنه مرتب است','پارگی بزرگ دیده نمی‌شود']}});assert.equal(reviewed.reviewedPhotoCount,2);assert(reviewed.score>initial.score);
  const damaged=conditionScore({...base,desc:'نیاز به تعمیر دارد',quality:{method:'photos-and-description',verdict:'promising',photoCount:2,observations:[]}});assert(damaged.score<=70);
});
test('Listing map location takes priority over a neighbourhood estimate',()=>{
  const points={'مرجع':{lat:35.75,lon:51.45,type:'neighbourhood',source:'OSM'}};
  const a=listingDistance({area:'مرجع'},points);assert(a.distanceKm>0);assert.equal(a.distanceSource,'OSM');
  const b=listingDistance({area:'مرجع',locationPoint:{lat:35.7155645,lon:51.4260941,precision:'EXACT'}},points);assert.equal(b.distanceKm,0);assert.equal(b.distanceSource,'divar-map');
  assert.equal(sourceMapPoint({MAP:[{dto:{data:{location:{type:'EXACT',exact_data:{point:{latitude:35.7,longitude:51.4}}}}}}]}).lat,35.7);
  assert.equal(listingDistance({area:'missing'},points).distanceKm,null);
});
test('A primary-photo score is invalidated by edited descriptions or gallery content',async()=>{
  const ad={id:'fixture',category:'مبل و کاناپه',title:'مبل',desc:'کارکرده',condition:'کارکرده',pics:['one','two']};
  const assessment={version:1,id:ad.id,fingerprint:await reviewFingerprint(ad),method:'primary-photo',photoCount:1,photoUrl:'one',reviewedAt:Date.now(),appearanceScore:40,observations:['در عکس اصلی آسیب روی سطح دیده می‌شود.']};
  const matched=await attachPhotoAssessment(ad,assessment);
  assert.equal(conditionScore(matched).method,'primary-photo-and-description');
  assert.equal(conditionScore(matched).reviewedPhotoCount,1);
  assert(conditionScore(matched).score<conditionScore(ad).score);
  for(const changed of [{...matched,desc:'توضیح عوض شده'},{...matched,pics:['one','three']}])assert.equal((await attachPhotoAssessment(changed,assessment)).photoAssessment,undefined);
});
