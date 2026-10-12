import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedAt,publishedAtInfo,preservePostingTime,storedPostingTime} from '../src/divar.mjs';
import {formatListingTime} from '../docs/listing-time.js';
const now=Date.parse('2026-10-12T08:00:00.000Z');
const section=(title,text='')=>[{dto:{widget_type:'EXPANDABLE_SECTION',data:{title,widget_list:[{widget_type:'DESCRIPTION_ROW',data:{text}}]}}}];

test('Divar original publication wins over a relative title and later updates',()=>{
  const raw=section('نیم ساعت پیش در تهران','انتشار آگهی: ۱۹ مهر ۱۴۰۵، ۱۵:۳۰\nآخرین بروزرسانی: ۲۰ مهر ۱۴۰۵، ۱۰:۳۰');
  const expected={postedAt:1791720000000,postedAtIso:'2026-10-11T12:00:00.000Z',postedAtSource:'divar-absolute',postedAtIsApproximate:false};
  assert.deepEqual(publishedAtInfo(raw,now),expected);
  assert.deepEqual(publishedAtInfo(raw,now+7*86400000),expected);
  assert.equal(publishedAt(raw,now),expected.postedAt);
});

test('Relative source labels become a stored absolute estimate with explicit provenance',()=>{
  assert.deepEqual(publishedAtInfo(section('۲ ساعت پیش در تهران'),now),{postedAt:now-3*3600000,postedAtIso:'2026-10-12T05:00:00.000Z',postedAtSource:'divar-relative',postedAtIsApproximate:true});
  for(const label of ['دیروز','۱ روز پیش','۱ هفته پیش','۱ ماه پیش','نیم ساعت پیش'])assert.equal(publishedAtInfo(section(label),now),null);
  assert.equal(publishedAtInfo(section('','انتشار آگهی: ۱۹ مهر ۱۴۰۵، ۲۵:۳۰'),now),null);
});

test('Refresh cannot replace an original timestamp with a newly computed estimate',()=>{
  const prior={id:'example',...publishedAtInfo(section('','انتشار آگهی: ۱۹ مهر ۱۴۰۵، ۱۵:۳۰'),now),expiresAt:1791720000000+86400000};
  const fetched={id:'example',...publishedAtInfo(section('۲ ساعت پیش در تهران'),now),verifiedAt:now};
  const merged=preservePostingTime(fetched,prior);
  assert.equal(merged.postedAt,prior.postedAt);
  assert.equal(merged.postedAtSource,'divar-absolute');
  assert.equal(merged.expiresAt,prior.expiresAt);
  assert.equal(merged.verifiedAt,now);
  const legacy=storedPostingTime({postedAt:prior.postedAt});
  assert.equal(legacy.postedAtIsApproximate,null);
  assert.equal(preservePostingTime(fetched,legacy).postedAt,prior.postedAt);
  assert.equal(preservePostingTime({...fetched,postedAtSource:'divar-absolute'},prior).postedAt,fetched.postedAt);
});

test('Relative display advances after a week while absolute publication stays fixed',()=>{
  const postedAt=Date.parse('2026-10-11T12:00:00.000Z');
  const first=formatListingTime(postedAt,postedAt+86400000);
  const later=formatListingTime(postedAt,postedAt+7*86400000);
  assert.equal(first.relative,'۱ روز پیش');
  assert.equal(later.relative,'۱ هفته پیش');
  assert.equal(first.datetime,later.datetime);
  assert.equal(first.absolute,later.absolute);
  assert.match(first.absolute,/۱۵:۳۰/);
  for(const invalid of [null,undefined,'دیروز',NaN,Infinity,0,9e20])assert.equal(formatListingTime(invalid,now).datetime,null);
});
