const numberFormat = new Intl.NumberFormat('fa-IR');
const dateFormat = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  dateStyle: 'medium',
  timeStyle: 'short',
});

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const units = [
  [365 * day, 'سال'],
  [30 * day, 'ماه'],
  [7 * day, 'هفته'],
  [day, 'روز'],
  [hour, 'ساعت'],
  [minute, 'دقیقه'],
];

// Only a saved Unix timestamp in milliseconds can establish the posting time.
// Labels from Divar describe the age at collection and must not be reused later.
export function formatListingTime(postedAt, now = Date.now()) {
  if (typeof postedAt !== 'number' || !Number.isFinite(postedAt) || postedAt <= 0 ||
      !Number.isFinite(now) || !Number.isFinite(new Date(postedAt).getTime())) {
    return { relative: 'زمان انتشار نامشخص', absolute: null, datetime: null };
  }

  const elapsed = now - postedAt;
  const duration = Math.abs(elapsed);
  const suffix = elapsed >= 0 ? 'پیش' : 'دیگر';
  const unit = units.find(([size]) => duration >= size);
  const relative = unit
    ? `${numberFormat.format(Math.floor(duration / unit[0]))} ${unit[1]} ${suffix}`
    : `لحظاتی ${suffix}`;

  return {
    relative,
    absolute: dateFormat.format(postedAt),
    datetime: new Date(postedAt).toISOString(),
  };
}
