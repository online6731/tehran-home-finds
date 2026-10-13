const normalize=s=>String(s||'').replace(/[\u200c\u200fـ]/g,' ').replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/\s+/g,' ').trim();
export function aerialDistance(lat,lon){
  const rad=n=>n*Math.PI/180,a=Math.sin(rad(lat-35.7155645)/2)**2+Math.cos(rad(lat))*Math.cos(rad(35.7155645))*Math.sin(rad(lon-51.4260941)/2)**2;
  return Math.round(2*6371.0088*Math.asin(Math.sqrt(a))*10)/10;
}
export function usablePoint(p){return p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>=35.55&&p.lat<=35.86&&p.lon>=51.08&&p.lon<=51.63;}
export function neighbourhoodPoint(area,points){
  const p=points[area]||Object.entries(points).find(([name])=>normalize(name)===normalize(area))?.[1];
  return usablePoint(p)&&['administrative','neighbourhood','suburb','quarter','locality'].includes(p.type)?p:null;
}
export function listingDistance(ad,points){
  if(usablePoint(ad.locationPoint))return {distanceKm:aerialDistance(ad.locationPoint.lat,ad.locationPoint.lon),distanceSource:'divar-map',distanceReference:ad.locationPoint.precision==='EXACT'?'نقطهٔ نقشهٔ آگهی':'موقعیت تقریبی نقشهٔ آگهی'};
  const p=neighbourhoodPoint(ad.area,points);
  return p?{distanceKm:aerialDistance(p.lat,p.lon),distanceSource:p.source||'OpenStreetMap',distanceReference:'مرکز تقریبی محلهٔ '+ad.area}:{distanceKm:null,distanceSource:null,distanceReference:null};
}
export function sourceMapPoint(sections){
  for(const w of sections.MAP||[]){
    const location=w.dto?.data?.location,point=location?.exact_data?.point||location?.approximate_data?.point;
    const p={lat:point?.latitude,lon:point?.longitude,precision:location?.type};
    if(usablePoint(p))return p;
  }
  return null;
}
