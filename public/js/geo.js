const EARTH_RADIUS = 6_371_000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function haversine(a, b) {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

export function midpoint(a, b) {
  const lat1 = toRadians(a.lat);
  const lng1 = toRadians(a.lng);
  const lat2 = toRadians(b.lat);
  const deltaLng = toRadians(b.lng - a.lng);

  const bx = Math.cos(lat2) * Math.cos(deltaLng);
  const by = Math.cos(lat2) * Math.sin(deltaLng);
  const lat = Math.atan2(
    Math.sin(lat1) + Math.sin(lat2),
    Math.sqrt((Math.cos(lat1) + bx) ** 2 + by ** 2),
  );
  const lng = lng1 + Math.atan2(by, Math.cos(lat1) + bx);

  return {
    lat: toDegrees(lat),
    lng: ((toDegrees(lng) + 540) % 360) - 180,
  };
}

export function centroid(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    const lat = toRadians(point.lat);
    const lng = toRadians(point.lng);
    x += Math.cos(lat) * Math.cos(lng);
    y += Math.cos(lat) * Math.sin(lng);
    z += Math.sin(lat);
  }

  const lng = Math.atan2(y, x);
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  return {
    lat: toDegrees(lat),
    lng: ((toDegrees(lng) + 540) % 360) - 180,
  };
}

export function destination(center, bearingDegrees, distanceMeters) {
  const angular = distanceMeters / EARTH_RADIUS;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(center.lat);
  const lng1 = toRadians(center.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: toDegrees(lat2),
    lng: ((toDegrees(lng2) + 540) % 360) - 180,
  };
}

export function circlePolygon(center, radiusMeters, steps = 64) {
  const ring = [];
  for (let index = 0; index <= steps; index += 1) {
    const point = destination(center, (index * 360) / steps, radiusMeters);
    ring.push([point.lng, point.lat]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

export function zoomForRadius(radiusKm) {
  return clamp(Math.round(17 - Math.log2(Math.max(radiusKm, 0.5))), 12, 17);
}
