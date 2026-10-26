// @ts-nocheck
import { TtlCache } from './cache.js';
import { SerialQueue } from './queue.js';
import { SlidingWindowLimiter } from './rate-limit.js';
import * as goong from './goong.js';
import * as serpapi from './serpapi.js';
import { routeOf } from './route.js';
import {
  coordinate,
  coordinateList,
  integer,
  ll,
  number,
  placeId,
  text,
  vehicle,
  ValidationError,
} from './validate.js';

const goongCache = new TtlCache({ maxEntries: 600 });
const serpCache = new TtlCache({ maxEntries: 200 });
const goongQueue = new SerialQueue({ minIntervalMs: 300 });
const serpQueue = new SerialQueue({ minIntervalMs: 1_000 });
const goongLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 120 });
const serpLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 10 });

const TTL = {
  autocomplete: 5 * 60_000,
  detail: 24 * 60 * 60_000,
  matrix: 10 * 60_000,
  directions: 30 * 60_000,
  discover: 30 * 60_000,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function keyOf(value) {
  return `${value.lat.toFixed(5)},${value.lng.toFixed(5)}`;
}

function clientKey(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  return (
    forwarded?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'anonymous'
  );
}

function tooMany() {
  return json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429);
}

export async function handle(request) {
  const url = new URL(request.url);
  const route = routeOf(url.pathname);

  if (request.method !== 'GET') {
    return json(
      { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET' } },
      405,
    );
  }

  try {
    if (route === '/health') return json({ ok: true });

    if (route === '/config') {
      const mapKey = Deno.env.get('GOONG_MAP_KEY');
      if (!mapKey) {
        return json(
          { error: { code: 'CONFIG_MISSING', message: 'Map key is missing' } },
          500,
        );
      }
      return json({
        mapStyle: `https://tiles.goong.io/assets/goong_map_web.json?api_key=${encodeURIComponent(mapKey)}`,
        center: { lat: 21.0285, lng: 105.8542 },
        zoom: 12,
      });
    }

    if (route === '/places/autocomplete') {
      if (!goongLimiter.take(clientKey(request))) return tooMany();

      const input = text(url.searchParams.get('input'), { name: 'input', max: 100 });
      const locationParam = url.searchParams.get('location');
      const originParam = url.searchParams.get('origin');
      const location = locationParam ? coordinate(locationParam, 'location') : null;
      const origin = originParam ? coordinate(originParam, 'origin') : null;
      const radiusParam = url.searchParams.get('radius');
      const limitParam = url.searchParams.get('limit');
      const radius = radiusParam
        ? number(radiusParam, { name: 'radius', min: 0.1, max: 50 })
        : null;
      const limit = limitParam
        ? integer(limitParam, { name: 'limit', min: 1, max: 10 })
        : 5;

      const cacheKey = [
        'ac',
        input.toLowerCase(),
        location ? keyOf(location) : '-',
        origin ? keyOf(origin) : '-',
        radius ?? '-',
        limit,
      ].join(':');

      const data = await goongCache.getOrLoad(cacheKey, TTL.autocomplete, () =>
        goongQueue.run(() =>
          goong.autocomplete({
            input,
            location,
            origin,
            radius,
            limit,
            apiKey: Deno.env.get('GOONG_REST_KEY'),
          }),
        ),
      );
      return json(data);
    }

    if (route === '/places/detail') {
      if (!goongLimiter.take(clientKey(request))) return tooMany();

      const id = placeId(url.searchParams.get('placeId'));
      const data = await goongCache.getOrLoad(`detail:${id}`, TTL.detail, () =>
        goongQueue.run(() =>
          goong.detail({
            placeId: id,
            apiKey: Deno.env.get('GOONG_REST_KEY'),
          }),
        ),
      );
      return json(data);
    }

    if (route === '/places/matrix') {
      if (!goongLimiter.take(clientKey(request))) return tooMany();

      const origins = coordinateList(url.searchParams.get('origins'), {
        name: 'origins',
        min: 1,
        max: 6,
      });
      const destinations = coordinateList(url.searchParams.get('destinations'), {
        name: 'destinations',
        min: 1,
        max: 10,
      });
      const mode = vehicle(url.searchParams.get('vehicle') || undefined);
      const cacheKey = [
        'matrix',
        mode,
        origins.map(keyOf).join('|'),
        destinations.map(keyOf).join('|'),
      ].join(':');

      const data = await goongCache.getOrLoad(cacheKey, TTL.matrix, () =>
        goongQueue.run(() =>
          goong.matrix({
            origins,
            destinations,
            vehicle: mode,
            apiKey: Deno.env.get('GOONG_REST_KEY'),
          }),
        ),
      );
      return json(data);
    }

    if (route === '/places/directions') {
      if (!goongLimiter.take(clientKey(request))) return tooMany();

      const origin = coordinate(url.searchParams.get('origin'), 'origin');
      const destination = coordinate(
        url.searchParams.get('destination'),
        'destination',
      );
      const mode = vehicle(url.searchParams.get('vehicle') || undefined);
      const cacheKey = `dir:${mode}:${keyOf(origin)}:${keyOf(destination)}`;

      const data = await goongCache.getOrLoad(cacheKey, TTL.directions, () =>
        goongQueue.run(() =>
          goong.directions({
            origin,
            destination,
            vehicle: mode,
            apiKey: Deno.env.get('GOONG_REST_KEY'),
          }),
        ),
      );
      return json(data);
    }

    if (route === '/discover') {
      if (!serpLimiter.take(clientKey(request))) return tooMany();

      const q = text(url.searchParams.get('q'), { name: 'q', max: 80 });
      const center = ll(url.searchParams.get('ll'));
      const cacheKey = `discover:${q.toLowerCase()}:${center}`;

      const data = await serpCache.getOrLoad(cacheKey, TTL.discover, () =>
        serpQueue.run(() =>
          serpapi.discover({
            q,
            ll: center,
            apiKey: Deno.env.get('SERPAPI_KEY'),
          }),
        ),
      );
      return json(data);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  } catch (error) {
    const status = error instanceof ValidationError ? 400 : error?.status || 502;
    if (status >= 500) {
      console.error(
        `[function] ${route} -> ${status} (${error?.code || error?.name || 'Error'})`,
      );
    }
    return json(
      {
        error: {
          code: error?.code || 'REQUEST_FAILED',
          message: status === 400 ? error.message : 'Request failed',
        },
      },
      status,
    );
  }
}

