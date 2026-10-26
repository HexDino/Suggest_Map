import { fetchJson, UpstreamError } from './upstream.js';

const DEFAULT_BASE = 'https://serpapi.com';

function requireKey(apiKey) {
  if (!apiKey) throw new UpstreamError('SerpApi key is missing', { code: 'CONFIG_MISSING' });
  return apiKey;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function discover({
  q,
  ll,
  apiKey,
  baseUrl = DEFAULT_BASE,
}) {
  const params = new URLSearchParams({
    engine: 'google_maps',
    q,
    ll,
    hl: 'vi',
    gl: 'vn',
    api_key: requireKey(apiKey),
  });

  const data = await fetchJson(`${baseUrl}/search.json?${params}`, { timeoutMs: 30_000 });
  if (data.search_metadata?.status && data.search_metadata.status !== 'Success') {
    throw new UpstreamError('Google Maps search failed', { code: 'UPSTREAM_ERROR' });
  }

  const raw = Array.isArray(data.local_results) ? data.local_results.slice(0, 20) : [];
  const places = raw
    .map((item) => {
      const lat = numberOrNull(item.gps_coordinates?.latitude ?? item.latitude);
      const lng = numberOrNull(item.gps_coordinates?.longitude ?? item.longitude);
      if (lat === null || lng === null) return null;
      return {
        googlePlaceId: item.place_id || null,
        name: item.title || '',
        address: item.address || '',
        lat,
        lng,
        rating: numberOrNull(item.rating),
        reviews: numberOrNull(item.reviews),
        type: item.type || item.types?.[0] || '',
        types: Array.isArray(item.types) ? item.types : [],
        openState: typeof item.open_state === 'string' ? item.open_state : '',
        price: typeof item.price === 'string' ? item.price : '',
        hours: typeof item.hours === 'string' ? item.hours : '',
        thumbnail: httpsUrl(item.thumbnail) || httpsUrl(item.serpapi_thumbnail),
      };
    })
    .filter((item) => item && item.name);

  return { places };
}
