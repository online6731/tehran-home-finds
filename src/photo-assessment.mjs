import {reviewFingerprint} from './quality.mjs';
// A primary-photo assessment is separate from a full-gallery quality review.
export async function attachPhotoAssessment(ad,assessment){
  const {photoAssessment:previous,...clean}=ad;
  if(!assessment||assessment.version!==1||assessment.method!=='primary-photo'||assessment.photoCount!==1||
    assessment.photoUrl!==ad.pics[0]||!Number.isFinite(assessment.reviewedAt)||assessment.reviewedAt>Date.now()||
    !Number.isFinite(assessment.appearanceScore)||assessment.appearanceScore<0||assessment.appearanceScore>100||
    assessment.fingerprint!==await reviewFingerprint(ad))return clean;
  return {...clean,photoAssessment:assessment};
}
