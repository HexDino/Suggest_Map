const kmFormatter = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});
const integerFormatter = new Intl.NumberFormat('vi-VN');

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${kmFormatter.format(meters / 1000)} km`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} phút`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
}

export function formatRating(rating) {
  if (!Number.isFinite(rating)) return '';
  return rating.toFixed(1).replace('.', ',');
}

export function formatReviews(count) {
  if (!Number.isFinite(count)) return '';
  return integerFormatter.format(count);
}
