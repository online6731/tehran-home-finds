// A review applies only to the exact description and gallery that were inspected.
// Price, age and scrape timestamps do not describe the physical condition.
export async function reviewFingerprint(ad){
  const content=JSON.stringify([1,ad.id,ad.category,ad.title,ad.desc||'',ad.condition,[...ad.pics]]);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
  return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
const textList=(value,min=0)=>Array.isArray(value)&&value.length>=min&&value.length<=5&&value.every(text=>typeof text==='string'&&text.trim().length>0&&text.length<=200);
export function validReview(review,ad,now=Date.now()){
  const evidence=review?.method==='photos-and-description'?
    ['promising','caution','unclear'].includes(review.verdict)&&review.photoCount===ad?.pics.length&&review.photoCount>0&&textList(review.observations,1)&&
      (review.verdict!=='promising'||review.observations.length>=2):
    review?.method==='seller-text'&&review.verdict==='candidate'&&review.photoCount===0&&textList(review.observations)&&review.observations.length===0&&textList(review.sellerClaims,1);
  return !!ad&&review?.version===1&&evidence&&
    (!review.audience||['adult','child','teen','unclear'].includes(review.audience))&&
    (!['child','teen'].includes(review.audience)||review.method==='photos-and-description'&&Array.isArray(review.audiencePhotoIndices)&&review.audiencePhotoIndices.length>0&&review.audiencePhotoIndices.every(i=>Number.isInteger(i)&&i>=1&&i<=ad.pics.length))&&
    /^[a-f0-9]{64}$/.test(review.fingerprint||'')&&
    Number.isFinite(review.reviewedAt)&&review.reviewedAt>=ad.postedAt&&review.reviewedAt<=now&&
    textList(review.cautions)&&textList(review.sellerClaims);
}
export async function matchReview(ad,review,now=Date.now()){
  if(ad.expiresAt<=now||!validReview(review,ad,now)||review.fingerprint!==await reviewFingerprint(ad))return null;
  return {version:1,method:review.method,verdict:review.verdict,reviewedAt:review.reviewedAt,photoCount:review.photoCount,observations:review.observations,cautions:review.cautions,sellerClaims:review.sellerClaims,...(review.audience?{audience:review.audience,audiencePhotoIndices:review.audiencePhotoIndices}: {})};
}
export async function attachReviews(ads,reviews,now=Date.now()){
  const map=new Map(reviews.map(review=>[review.id,review]));
  return Promise.all(ads.map(async ad=>{
    const {quality:discarded,...clean}=ad;
    const review=map.get(ad.id),quality=review?await matchReview(ad,review,now):null;
    return {...clean,quality};
  }));
}
