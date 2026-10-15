import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesAdultProduct} from '../src/audience.mjs';

test('Child and teen products are excluded in every category and in mixed bundles',()=>{
  for(const [title,desc,fields] of [
    ['کمد کودک پسر','',{}],['کمد بچه با ویترین','',{}],
    ['کمد بچهMdf ضدخش','',{}],['کمدبچه','',{}],['مخصوص بچه، سالم','',{}],
    ['کمد لباس','کمد لباس کودک کار کرده',{}],['فایل پلاستیکی کودک','',{}],
    ['جاکفشی و دراور به همراه تخت نوجوان','',{}],
    ['لباسشویی AEG مخصوص لباس بچه','',{}],['مینی واش','مناسب لباس نوزاد',{}],
    ['یخچال و فرش اتاق کودک','',{}],['مبل اتاق نو‌جوان','',{}],
    ['کمد','',{'نوع کالا':'کمد سیسمونی'}],['فرش ۶ متری طرح شرک','',{}],
    ['دراور طرح کیتی','',{}],['صندلی خردسال','',{}],['کمد بچگانه','',{}]
  ])assert(!matchesAdultProduct(title,desc,fields),title);
  assert(!matchesAdultProduct('کمد نقاشی شده','',{}, {audience:'child'}));
  assert(!matchesAdultProduct('کمد اسپرت','',{}, {audience:'teen'}));
});

test('Ordinary household products are not rejected by similar words or incidental decor',()=>{
  for(const [title,desc] of [
    ['جاکفشی شرکتی','رنگ کرمی کاملا سالم'],['کمد','ساخت شرکتیه'],
    ['کمد لباس نقاشی شده','اگر به کارتون میومد پیام بدید'],
    ['جاکفشی','روبروی مهدیه تهران'],['فرش ماشینی طرح گل','مناسب پذیرایی'],
    ['کمد صورتی','کاملا سالم و جادار'],['ماشین لباسشویی','ظرفیت ۸ کیلو']
  ])assert(matchesAdultProduct(title,desc),title);
});
