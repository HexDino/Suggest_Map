import { formatDistance, formatDuration } from './format.js';
import { haversine } from './geo.js';

export function preRank(places, { midpoint, people, radiusM, limit = 8 }) {
  const prepared = places
    .map((place) => {
      const distances = people.map((person) => haversine(person, place));
      const distanceMid = haversine(midpoint, place);
      const maxDistance = Math.max(...distances);
      const minDistance = Math.min(...distances);
      const balanceM = maxDistance - minDistance;
      const balanceRatio = balanceM / Math.max(maxDistance, 1);
      const closeness = 1 - Math.min(distanceMid / radiusM, 1);
      const rating = Number.isFinite(place.rating) ? place.rating / 5 : 0.6;

      return {
        ...place,
        distances,
        distanceMid,
        maxDistance,
        minDistance,
        balanceM,
        balanceRatio,
        prelimScore: 0.5 * (1 - balanceRatio) + 0.35 * closeness + 0.15 * rating,
      };
    })
    .filter((place) => place.distanceMid <= radiusM);

  prepared.sort(
    (first, second) =>
      second.prelimScore - first.prelimScore || first.distanceMid - second.distanceMid,
  );
  return prepared.slice(0, limit);
}

export function attachTravel(places, rows) {
  return places.map((place, index) => {
    const travels = rows.map((row) => {
      const leg = row?.elements?.[index];
      if (
        leg?.status !== 'OK' ||
        !Number.isFinite(leg.distanceMeters) ||
        !Number.isFinite(leg.durationSeconds)
      ) {
        return null;
      }
      return {
        distanceMeters: leg.distanceMeters,
        durationSeconds: leg.durationSeconds,
      };
    });

    const hasTravel = travels.length > 0 && travels.every(Boolean);
    const durations = travels.filter(Boolean).map((leg) => leg.durationSeconds);
    const maxDuration = hasTravel ? Math.max(...durations) : null;
    const minDuration = hasTravel ? Math.min(...durations) : null;
    const totalDuration = hasTravel
      ? durations.reduce((total, duration) => total + duration, 0)
      : null;

    return {
      ...place,
      travels,
      hasTravel,
      maxDuration,
      minDuration,
      totalDuration,
      balanceSeconds: hasTravel ? maxDuration - minDuration : null,
    };
  });
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
        return (
          first.totalDuration - second.totalDuration ||
          first.distanceMid - second.distanceMid
        );
      }
      if (first.hasTravel !== second.hasTravel) return first.hasTravel ? -1 : 1;
      const totalFirst = first.distances.reduce((total, distance) => total + distance, 0);
      const totalSecond = second.distances.reduce((total, distance) => total + distance, 0);
      return totalFirst - totalSecond || first.distanceMid - second.distanceMid;
    });
    return sorted;
  }

  sorted.sort((first, second) => {
    if (first.hasTravel && second.hasTravel) {
      return (
        first.balanceSeconds - second.balanceSeconds ||
        first.maxDuration - second.maxDuration ||
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
    const farthest = Math.max(place.maxDuration, 1);
    if (diff <= Math.max(120, farthest * 0.15)) {
      return { label: 'Cân bằng', tone: 'good' };
    }
    return {
      label: `Chênh ${formatDuration(diff)}`,
      tone: diff <= farthest * 0.35 ? 'warn' : 'far',
    };
  }

  const farthest = Math.max(place.maxDistance, 1);
  if (place.balanceM <= Math.max(300, farthest * 0.15)) {
    return { label: 'Cân bằng', tone: 'good' };
  }
  return { label: `Chênh ${formatDistance(place.balanceM)}`, tone: 'warn' };
}
