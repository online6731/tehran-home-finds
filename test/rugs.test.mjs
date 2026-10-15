import test from 'node:test';
import assert from 'node:assert/strict';
import {adultRugInfo,matchesAdultRug} from '../src/rugs.mjs';
test('Adult rugs require confirmed nominal size or measured area of at least four square metres',()=>{
  for(const [title,desc,fields] of [['فرش چهارمتری','',{}],['گلیم ۶متری','',{}],['فرش','ابعاد: ۴ متری (۱٫۵ در ۲٫۲۵ متر)',{}],['گلیم','ابعاد ۲۰۰ در ۳۰۰ سانتی‌متر',{}],['گلیم ۲ در ۲ متر','',{}],['گلیم','طول ۳متر عرض ۲متر',{}],['فرش','',{'ابعاد':'۹ متری (۲٫۵ در ۳٫۵ متر)'}]])assert(matchesAdultRug(title,desc,fields),title+' '+desc);
  for(const [title,desc] of [['فرش ۲متری',''],['گلیم ۱ در ۱/۵',''],['گلیم','طول ۲متر عرض ۵۰سانتیمتر'],['کناره ۵ متر','بدون عرض مشخص'],['فرش','ابعاد: ذرع و نیم (۱ در ۱٫۵ متر)'],['گلیم','اندازه نامشخص'],['فرش ۱۲متری','ابعاد: ۲ متری (۱٫۲۰ در ۱٫۸۰ متر)']])assert(!matchesAdultRug(title,desc),title+' '+desc);
  assert.equal(adultRugInfo('گلیم','ابعاد ۲۰۰ در ۳ متر').areaSquareMetres,6);
  assert.equal(adultRugInfo('فرش ۴،۵ متری').areaSquareMetres,4.5);
  assert(!matchesAdultRug('فرش ۳،۵ متری'));
  assert(!matchesAdultRug('کناره ۴ متری عرض ۹۶'));
  assert(!matchesAdultRug('کناره ۴ متری','بدون عرض مشخص'));
  assert(matchesAdultRug('کناره یک در ۴ متر'));
  assert(!matchesAdultRug('فرش ۴ متری شگی ابعاد ۱_۵ در ۲_۳۰','ابعاد ۱/۵ در ۲/۳۰',{'ابعاد':'سایر ابعاد'}));
  assert(!matchesAdultRug('فرش ۴متری','ابعاد: ۴ متری (۲ در ۲ متر)\nاندازه واقعی ۱٫۵ در ۲٫۳ متر'));
  assert(matchesAdultRug('فرش ۴متری','ابعاد: ۴ متری (۱٫۵ در ۲٫۲۵ متر)\nبدون پارگی'));
  assert(!matchesAdultRug('فرش نمدی','ابعاد: ۴ متری (۲ در ۲ متر)\nفرش نمدی . ابعاد ۲متر و ۲۰ س  *  ۱۴۳ س'));
  assert.equal(adultRugInfo('فرش','ابعاد ۲متر و ۲۰ سانت * ۲۰۰ سانت',{'ابعاد':'۴ متری'}).accepted,true);
});
test('Child and teen designs are rejected even when large and incorrectly labelled',()=>{
  for(const title of ['فرش کودک ۶متری','فرش نوجوان ۹متری','فرش طرح کیتی ۴متری','گلیم دخترانه ۶متری','فرش طرح ماشین ۴متری','فرش ۴متری السا و آنا','فرش بن تن ۶متری'])assert(!matchesAdultRug(title,''),title);
  assert(!matchesAdultRug('فرش ۶متری','',{}, {audience:'child'}));
  assert(matchesAdultRug('فرش ماشینی ۶متری طرح گل','مناسب پذیرایی'));
});

test('Rug bundles cannot include explicitly undersized rugs',()=>{
  assert(!matchesAdultRug('یک تخته فرش ۹متری___ دو تا ۳ متری','قیمت هر سه تخته',{'ابعاد':'۹ متری (۲٫۵ در ۳٫۵ متر)'}));
  assert(matchesAdultRug('دو تخته فرش ۹ متری و ۶ متری'));
  assert(!matchesAdultRug('فرش ۶ متری','ابعاد: ۶ متری (۲ در ۳ متر)\nفرش ۶ متری به همراه فرش گرد ۱ متری',{'ابعاد':'۶ متری (۲ در ۳ متر)'}));
});
