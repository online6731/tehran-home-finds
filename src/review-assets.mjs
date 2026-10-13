import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const input = (process.env.LISTING_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
if (!input.length || input.length > 10 || input.some(id => !/^[A-Za-z0-9_-]{8}$/.test(id))) {
  throw new Error('LISTING_IDS must contain 1–10 comma-separated Divar listing IDs.');
}
const ids = [...new Set(input)];
const snapshot = JSON.parse(await readFile(new URL('../docs/api/listings.json', import.meta.url), 'utf8'));
if (!Array.isArray(snapshot.ads)) throw new Error('The checked-out catalog has no ads array.');
const selected = ids.map(id => {
  const ad = snapshot.ads.find(ad => ad.id === id);
  if (!ad) throw new Error(`Listing ${id} is not in the checked-out catalog.`);
  if (!Array.isArray(ad.pics)) throw new Error(`Listing ${id} has no gallery array.`);
  return ad;
});
const photoCount = selected.reduce((count, ad) => count + ad.pics.length, 0);
if (photoCount > 100) throw new Error('The requested galleries exceed the 100-photo limit.');

// These are the only CDN host and gallery path shapes observed in this catalog.
// Download only the original URLs stored in the selected ads; never follow redirects.
function allowedPhoto(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 's100.divarcdn.com' && !url.port &&
      !url.username && !url.password && !url.search && !url.hash &&
      (/^\/static\/photo\/neda\/webp_post\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\.webp$/.test(url.pathname) ||
       /^\/static\/videos\/thumbnails\/thumbnail\/[A-Za-z0-9-]+\.jpg$/.test(url.pathname));
  } catch { return false; }
}

const directory = new URL('../artifacts/review-assets/', import.meta.url);
await mkdir(directory, { recursive: true });
const startedAt = Date.now();
const deadline = startedAt + 8 * 60 * 1000;
const metadata = {
  version: 1,
  collectedAt: new Date(startedAt).toISOString(),
  catalogCheckedAt: snapshot.checkedAt ?? null,
  catalogCommit: process.env.GITHUB_SHA || null,
  requestedIds: ids,
  photoCount,
  listings: []
};
const saveMetadata = () => writeFile(new URL('metadata.json', directory), JSON.stringify(metadata, null, 2) + '\n');
await saveMetadata();

async function download(url, target, result) {
  if (!allowedPhoto(url)) {
    result.status = 'rejected-url';
    result.error = 'URL is outside the observed Divar CDN gallery allowlist.';
    return;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      result.status = 'deadline-exceeded';
      result.error = 'The eight-minute download budget was exhausted.';
      return;
    }
    result.attempts = attempt;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(20_000, remaining)),
        redirect: 'error',
        headers: { Accept: 'image/webp,image/jpeg,image/*;q=0.8' }
      });
      result.httpStatus = response.status;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
      if (!['image/webp', 'image/jpeg'].includes(contentType)) throw new Error(`Unexpected content type: ${contentType}`);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 12 * 1024 * 1024) throw new Error('Photo exceeds the 12 MiB limit.');
        chunks.push(chunk);
      }
      if (!bytes) throw new Error('Empty photo response.');
      await writeFile(target, Buffer.concat(chunks));
      result.status = 'downloaded';
      result.contentType = contentType;
      result.bytes = bytes;
      delete result.error;
      return;
    } catch (error) {
      result.status = 'download-failed';
      result.error = String(error.message || error).slice(0, 300);
    }
  }
}

for (const ad of selected) {
  const { quality, ...textAndGallery } = ad;
  const listing = { ...textAndGallery, photos: [] };
  metadata.listings.push(listing);
  for (let index = 0; index < ad.pics.length; index++) {
    const url = ad.pics[index];
    // Preserve JPEG video thumbnails instead of mislabelling their bytes as WebP.
    const extension = typeof url === 'string' && url.endsWith('.jpg') ? 'jpg' : 'webp';
    const filename = `${ad.id}-${index}.${extension}`;
    const result = { index, url, filename, status: 'pending', attempts: 0 };
    listing.photos.push(result);
    await download(url, new URL(filename, directory), result);
    await saveMetadata();
    console.log(`${ad.id} photo ${index + 1}/${ad.pics.length}: ${result.status}`);
  }
}
metadata.finishedAt = new Date().toISOString();
metadata.downloadedPhotos = metadata.listings.flatMap(ad => ad.photos).filter(photo => photo.status === 'downloaded').length;
await saveMetadata();
console.log(`Saved ${metadata.downloadedPhotos}/${photoCount} photos and metadata to ${fileURLToPath(directory)}`);
if (metadata.downloadedPhotos !== photoCount) process.exitCode = 1;
