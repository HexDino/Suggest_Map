import { fetchJson, UpstreamError } from './upstream.js';

function base() {
  return process.env.GOONG_BASE_URL || 'https://rsapi.goong.io';
}

function apiKey() {
  const key = process.env.GOONG_REST_KEY;
  if (!key) throw new UpstreamError('Goong key is missing', { code: 'CONFIG_MISSING' });
  return key;
}

function coord(value) {
  return `${value.lat},${value.lng}`;
}

export async function autocomplete({ input, location, origin, radius, limit = 5 }) {
  const params = new URLSearchParams({
    input,
    limit: String(limit),
    api_key: apiKey(),
  });
  if (location) params.set('location', coord(location));
  if (origin) params.set('origin', coord(origin));
  if (radius !== null && radius !== undefined) params.set('radius', String(radius));

  const data = await fetchJson(`${base()}/v2/place/autocomplete?${params}`);
  return {
    predictions: (data.predictions || []).map((item) => ({
      placeId: item.place_id,
      description: item.description || '',
      mainText: item.structured_formatting?.main_text || item.description || '',
      secondaryText: item.structured_formatting?.secondary_text || '',
      distanceMeters: item.distance_meters ?? null,
    })),
  };
}

export async function detail(placeId) {
  const params = new URLSearchParams({ place_id: placeId, api_key: apiKey() });
  const data = await fetchJson(`${base()}/v2/place/detail?${params}`);
  const result = data.result;
  const lat = result?.geometry?.location?.lat;
  const lng = result?.geometry?.location?.lng;
  if (!result || typeof lat !== 'number' || typeof lng !== 'number') {
    throw new UpstreamError('Place was not found', { status: 404, code: 'PLACE_NOT_FOUND' });
  }
  return {
    place: {
      placeId: result.place_id || placeId,
      name: result.name || result.formatted_address || '',
      address: result.formatted_address || '',
      lat,
      lng,
      types: Array.isArray(result.types) ? result.types : [],
      url: result.url || null,
    },
  };
}

export async function matrix({ origins, destinations, vehicle = 'car' }) {
  const params = new URLSearchParams({
    origins: origins.map(coord).join('|'),
    destinations: destinations.map(coord).join('|'),
    vehicle,
    api_key: apiKey(),
  });
  const data = await fetchJson(`${base()}/v2/distancematrix?${params}`);
  return {
    rows: (data.rows || []).map((row) => ({
      elements: (row.elements || []).map((element) => ({
        distanceMeters: element.distance?.value ?? null,
        durationSeconds: element.duration?.value ?? null,
        status: element.status || 'UNKNOWN',
      })),
    })),
  };
}

export async function directions({ origin, destination, vehicle = 'car' }) {
  const params = new URLSearchParams({
    origin: coord(origin),
    destination: coord(destination),
    vehicle,
    api_key: apiKey(),
  });
  const data = await fetchJson(`${base()}/v2/direction?${params}`);
  const route = data.routes?.[0];
  if (!route) {
    throw new UpstreamError('Route was not found', { status: 404, code: 'ROUTE_NOT_FOUND' });
  }
  const leg = route.legs?.[0];
  return {
    route: {
      distanceMeters: leg?.distance?.value ?? null,
      durationSeconds: leg?.duration?.value ?? null,
      polyline: route.overview_polyline?.points || null,
    },
  };
}
