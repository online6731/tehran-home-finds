import test from 'node:test';
import assert from 'node:assert/strict';
import {categories,matchesHomeCategory} from '../src/divar.mjs';
import {matchesAdultProduct} from '../src/audience.mjs';

test('Mirrors use the official category and reject unrelated products and services',()=>{
  assert.equal(categories.mirror,'آینه');
  for(const title of ['آینه قدی','اینه دیواری','آیینه و کنسول'])assert(matchesHomeCategory('mirror',title),title);
  for(const title of ['نصب آینه','قاب خالی آینه','آینه بغل خودرو','خریدار آینه','دراور بدون آینه','کنسول بدون شیشه'])assert(!matchesHomeCategory('mirror',title),title);
  assert(!matchesAdultProduct('آینه اتاق کودک','',{}));
});
