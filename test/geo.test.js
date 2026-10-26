import test from 'node:test';
import assert from 'node:assert/strict';
import {
  centroid,
  circlePolygon,
  haversine,
  midpoint,
  zoomForRadius,
} from '../public/js/geo.js';

test('haversine tính khoảng cách cơ bản', () => {
  const distance = haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  assert.ok(Math.abs(distance - 111_195) < 300);
});

test('midpoint nằm giữa hai điểm đối xứng', () => {
  const center = midpoint({ lat: 0, lng: 0 }, { lat: 0, lng: 2 });
  assert.ok(Math.abs(center.lat) < 1e-9);
  assert.ok(Math.abs(center.lng - 1) < 1e-9);
});

test('centroid nằm giữa một nhóm điểm', () => {
  const center = centroid([
    { lat: 0, lng: 0 },
    { lat: 0, lng: 2 },
    { lat: 0, lng: 4 },
  ]);
  assert.ok(Math.abs(center.lat) < 1e-9);
  assert.ok(Math.abs(center.lng - 2) < 1e-9);
});

test('circlePolygon tạo vòng tròn khép kín đúng bán kính', () => {
  const center = { lat: 21.0285, lng: 105.8542 };
  const polygon = circlePolygon(center, 1_000, 32);
  const ring = polygon.geometry.coordinates[0];

  assert.equal(ring.length, 33);
  assert.deepEqual(ring[0], ring[ring.length - 1]);

  for (const [lng, lat] of ring) {
    const distance = haversine(center, { lat, lng });
    assert.ok(Math.abs(distance - 1_000) < 2);
  }
});

test('zoomForRadius giảm khi bán kính tăng', () => {
  assert.equal(zoomForRadius(1), 17);
  assert.equal(zoomForRadius(3), 15);
  assert.equal(zoomForRadius(10), 14);
  assert.equal(zoomForRadius(0.1), 17);
});
