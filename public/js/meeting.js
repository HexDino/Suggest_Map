import { centroid, clamp, destination, haversine } from './geo.js';

export function geometricMedian(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  if (points.length === 1) return { ...points[0] };

  let current = {
    lat: points.reduce((total, point) => total + point.lat, 0) / points.length,
    lng: points.reduce((total, point) => total + point.lng, 0) / points.length,
  };

  for (let iteration = 0; iteration < 30; iteration += 1) {
    let numeratorLat = 0;
    let numeratorLng = 0;
    let denominator = 0;

    for (const point of points) {
      const distance = haversine(current, point);
      if (distance < 0.5) return current;
      const weight = 1 / distance;
      numeratorLat += point.lat * weight;
      numeratorLng += point.lng * weight;
      denominator += weight;
    }

    const next = {
      lat: numeratorLat / denominator,
      lng: numeratorLng / denominator,
    };
    if (haversine(current, next) < 1) return next;
    current = next;
  }

  return current;
}

export function generateMeetingCandidates({ people, radiusM }) {
  if (!Array.isArray(people) || people.length === 0) return [];
  if (people.length === 1) return [{ ...people[0] }];

  const center = centroid(people);
  const median = geometricMedian(people) || center;
  const spread = Math.max(
    ...people.map((person) => haversine(center, person)),
    0,
  );
  const ring = clamp(spread, 300, Math.max(radiusM * 0.7, 300));
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315];

  const candidates = [
    center,
    median,
    ...bearings.map((bearing) => destination(center, bearing, ring)),
  ];

  const seen = new Set();
  return candidates
    .filter((candidate) => {
      const key = `${candidate.lat.toFixed(5)},${candidate.lng.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function chooseMeetingPoint(candidates, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const valid = candidates
    .map((candidate, index) => {
      const legs = rows.map((row) => row?.elements?.[index]);
      if (
        legs.length !== rows.length ||
        !legs.every(
          (leg) =>
            leg?.status === 'OK' &&
            Number.isFinite(leg.durationSeconds) &&
            Number.isFinite(leg.distanceMeters),
        )
      ) {
        return null;
      }

      const durations = legs.map((leg) => leg.durationSeconds);
      const maxDuration = Math.max(...durations);
      const minDuration = Math.min(...durations);
      return {
        ...candidate,
        maxDuration,
        minDuration,
        spreadSeconds: maxDuration - minDuration,
        totalDuration: durations.reduce((total, duration) => total + duration, 0),
      };
    })
    .filter(Boolean);

  valid.sort(
    (first, second) =>
      first.maxDuration - second.maxDuration ||
      first.spreadSeconds - second.spreadSeconds ||
      first.totalDuration - second.totalDuration,
  );
  return valid[0] || null;
}
