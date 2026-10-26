import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TtlCache } from '../functions/cache.js';
import { SerialQueue } from '../functions/queue.js';
import { SlidingWindowLimiter } from '../functions/rate-limit.js';
import * as goong from '../functions/goong.js';
import * as serpapi from '../functions/serpapi.js';
import {
  coordinate,
  coordinateList,
  integer,
  ll,
  number,
  placeId,
  text,
  vehicle,
} from '../functions/validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

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

function keyOf(value) {
  return `${value.lat.toFixed(5)},${value.lng.toFixed(5)}`;
}

function rateLimit(limiter) {
  return (req, res, next) => {
    const identity = req.ip || req.socket.remoteAddress || 'local';
    if (!limiter.take(identity)) {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
      return;
    }
    next();
  };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  const api = express.Router();
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  api.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  api.get('/config', (req, res) => {
    const mapKey = process.env.GOONG_MAP_KEY;
    if (!mapKey) {
      res.status(500).json({ error: { code: 'CONFIG_MISSING', message: 'Map key is missing' } });
      return;
    }
    res.json({
      mapStyle: `https://tiles.goong.io/assets/goong_map_web.json?api_key=${encodeURIComponent(mapKey)}`,
      center: { lat: 21.0285, lng: 105.8542 },
      zoom: 12,
    });
  });

  api.get('/places/autocomplete', rateLimit(goongLimiter), async (req, res) => {
    const input = text(req.query.input, { name: 'input', max: 100 });
    const location = req.query.location ? coordinate(req.query.location, 'location') : null;
    const origin = req.query.origin ? coordinate(req.query.origin, 'origin') : null;
    const radius = req.query.radius
      ? number(req.query.radius, { name: 'radius', min: 0.1, max: 50 })
      : null;
    const limit = req.query.limit
      ? integer(req.query.limit, { name: 'limit', min: 1, max: 10 })
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
          apiKey: process.env.GOONG_REST_KEY,
          baseUrl: process.env.GOONG_BASE_URL,
        }),
      ),
    );
    res.json(data);
  });

  api.get('/places/detail', rateLimit(goongLimiter), async (req, res) => {
    const id = placeId(req.query.placeId);
    const data = await goongCache.getOrLoad(`detail:${id}`, TTL.detail, () =>
      goongQueue.run(() =>
        goong.detail({
          placeId: id,
          apiKey: process.env.GOONG_REST_KEY,
          baseUrl: process.env.GOONG_BASE_URL,
        }),
      ),
    );
    res.json(data);
  });

  api.get('/places/matrix', rateLimit(goongLimiter), async (req, res) => {
    const origins = coordinateList(req.query.origins, { name: 'origins', min: 1, max: 6 });
    const destinations = coordinateList(req.query.destinations, {
      name: 'destinations',
      min: 1,
      max: 10,
    });
    const mode = vehicle(req.query.vehicle);
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
          apiKey: process.env.GOONG_REST_KEY,
          baseUrl: process.env.GOONG_BASE_URL,
        }),
      ),
    );
    res.json(data);
  });

  api.get('/places/directions', rateLimit(goongLimiter), async (req, res) => {
    const origin = coordinate(req.query.origin, 'origin');
    const destination = coordinate(req.query.destination, 'destination');
    const mode = vehicle(req.query.vehicle);
    const cacheKey = `dir:${mode}:${keyOf(origin)}:${keyOf(destination)}`;

    const data = await goongCache.getOrLoad(cacheKey, TTL.directions, () =>
      goongQueue.run(() =>
        goong.directions({
          origin,
          destination,
          vehicle: mode,
          apiKey: process.env.GOONG_REST_KEY,
          baseUrl: process.env.GOONG_BASE_URL,
        }),
      ),
    );
    res.json(data);
  });

  api.get('/discover', rateLimit(serpLimiter), async (req, res) => {
    const q = text(req.query.q, { name: 'q', max: 80 });
    const center = ll(req.query.ll);
    const cacheKey = `discover:${q.toLowerCase()}:${center}`;

    const data = await serpCache.getOrLoad(cacheKey, TTL.discover, () =>
      serpQueue.run(() =>
        serpapi.discover({
          q,
          ll: center,
          apiKey: process.env.SERPAPI_KEY,
          baseUrl: process.env.SERPAPI_BASE_URL,
        }),
      ),
    );
    res.json(data);
  });

  api.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  app.use('/api', api);
  app.use('/functions/v1/app', api);
  app.use(express.static(publicDir, { extensions: ['html'], etag: true, maxAge: 0 }));

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (req.destroyed) return;

    const status = error.status || 502;
    if (status >= 500) {
      console.error(
        `[${new Date().toISOString()}] ${req.method} ${req.path} -> ${status} (${error.code || error.name})`,
      );
    }
    res.status(status).json({
      error: {
        code: error.code || 'REQUEST_FAILED',
        message: status === 400 ? error.message : 'Request failed',
      },
    });
  });

  return app;
}
