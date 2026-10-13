import fs from 'node:fs';
import {sourceMapPoint} from './locations.mjs';
const snapshot=JSON.parse(fs.readFileSync(new URL('../docs/api/listings.json',import.meta.url)));
const selected=(process.env.LISTING_IDS||'').split(',').filter(Boolean);
if(!selected.length||selected.length>100||selected.some(id=>!/^[A-Za-z0-9_-]{8}$/.test(id)))throw Error('1–100 catalog IDs required');
const rows=[];
for(const id of selected){
  const ad=snapshot.ads.find(ad=>ad.id===id);if(!ad)throw Error('Unknown catalog ID');
  try{
    const r=await fetch('https://api.divar.ir/v8/posts-v2/web/'+id,{headers:{Accept:'application/json-filled','X-Render-Type':'CSR','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('HTTP '+r.status);const raw=await r.json();
    const sections=Object.fromEntries(raw.sections.map(s=>[s.section_name,s.widgets.map(w=>({dto:{data:w.data}}))]));
    rows.push({id,area:ad.area,point:sourceMapPoint(sections),fetchedAt:new Date().toISOString()});
  }catch(e){rows.push({id,area:ad.area,error:e.message});}
  await new Promise(r=>setTimeout(r,1200));
  console.log(id,rows.at(-1).point?'point':'no point');
}
fs.mkdirSync('artifacts/locations',{recursive:true});fs.writeFileSync('artifacts/locations/locations.json',JSON.stringify(rows,null,2));
