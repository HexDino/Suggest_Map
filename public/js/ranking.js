import { formatDistance, formatDuration } from './format.js';
import { haversine } from './geo.js';

export function preRank(places, { midpoint, a, b, radiusM, limit = 8 }) {
  const prepared = places
    .map((place) => ({
      ...place,
      distanceMid: haversine(midpoint, place),
      distanceA: haversine(a, place),
      distanceB: haversine(b, place),
    }))
    .filter((place) => place.distanceMid <= radiusM);

  for (const place of prepared) {
    const farthest = Math.max(place.distanceA, place.distanceB, 1);
    place.balanceM = Math.abs(place.distanceA - place.distanceB);
    place.balanceRatio = place.balanceM / farthest;
    const closeness = 1 - Math.min(place.distanceMid / radiusM, 1);
    const rating = Number.isFinite(place.rating) ? place.rating / 5 : 0.6;
    place.prelimScore = 0.55 * (1 - place.balanceRatio) + 0.35 * closeness + 0.1 * rating;
  }

  prepared.sort(
    (first, second) =>
      second.prelimScore - first.prelimScore || first.distanceMid - second.distanceMid,
  );
  return prepared.slice(0, limit);
}

export function attachTravel(places, rows) {
  const rowA = rows?.[0]?.elements || [];
  const rowB = rows?.[1]?.elements || [];

  return places.map((place, index) => {
    const legA = rowA[index];
    const legB = rowB[index];
    const travelA =
      legA?.status === 'OK' &&
      Number.isFinite(legA.distanceMeters) &&
      Number.isFinite(legA.durationSeconds)
        ? { distanceMeters: legA.distanceMeters, durationSeconds: legA.durationSeconds }
        : null;
    const travelB =
      legB?.status === 'OK' &&
      Number.isFinite(legB.distanceMeters) &&
      Number.isFinite(legB.durationSeconds)
        ? { distanceMeters: legB.distanceMeters, durationSeconds: legB.durationSeconds }
        : null;
    const hasTravel = Boolean(travelA && travelB);
    return {
      ...place,
      travelA,
      travelB,
      hasTravel,
      balanceSeconds: hasTravel
        ? Math.abs(travelA.durationSeconds - travelB.durationSeconds)
        : null,
    };
  });
}

function earliest(first, second) {
  return first - second;
}

export function sortResults(places, mode) {
  const sorted = [...places];

  if (mode === 'midpoint') {
    sorted.sort((first, second) => first.distanceMid - second.distanceMid);
    return sorted;
  }

  if (mode === 'total') {
    sorted.sort((first, second) => {
      if (first.hasTravel && second.hasTravel) {
        const totalFirst = first.travelA.durationSeconds + first.travelB.durationSeconds;
        const totalSecond = second.travelA.durationSeconds + second.travelB.durationSeconds;
        return earliest(totalFirst, totalSecond) || first.distanceMid - second.distanceMid;
      }
      if (first.hasTravel !== second.hasTravel) return first.hasTravel ? -1 : 1;
      return (
        first.distanceA + first.distanceB - (second.distanceA + second.distanceB) ||
        first.distanceMid - second.distanceMid
      );
    });
    return sorted;
  }

  sorted.sort((first, second) => {
    if (first.hasTravel && second.hasTravel) {
      const maxFirst = Math.max(first.travelA.durationSeconds, first.travelB.durationSeconds);
      const maxSecond = Math.max(second.travelA.durationSeconds, second.travelB.durationSeconds);
      return (
        earliest(first.balanceSeconds, second.balanceSeconds) ||
        earliest(maxFirst, maxSecond) ||
        first.distanceMid - second.distanceMid
      );
    }
    if (first.hasTravel !== second.hasTravel) return first.hasTravel ? -1 : 1;
    return first.balanceM - second.balanceM || first.distanceMid - second.distanceMid;
  });
  return sorted;
}

export function fairness(place) {
  if (place.hasTravel) {
    const diff = place.balanceSeconds;
    const farthest = Math.max(
      place.travelA.durationSeconds,
      place.travelB.durationSeconds,
      1,
    );
    if (diff <= Math.max(120, farthest * 0.15)) {
      return { label: 'Cân bằng', tone: 'good' };
    }
    return { label: `Lệch ${formatDuration(diff)}`, tone: 'warn' };
  }

  const farthest = Math.max(place.distanceA, place.distanceB, 1);
  if (place.balanceM <= Math.max(300, farthest * 0.15)) {
    return { label: 'Cân bằng', tone: 'good' };
  }
  return { label: `Lệch ${formatDistance(place.balanceM)}`, tone: 'warn' };
}
