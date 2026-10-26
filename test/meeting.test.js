import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseMeetingPoint,
  generateMeetingCandidates,
  geometricMedian,
} from '../public/js/meeting.js';

test('geometricMedian bị kéo về phía đa số thay vì điểm xa', () => {
  const median = geometricMedian([
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 0, lng: 10 },
  ]);
  assert.ok(Math.abs(median.lat) < 1e-9);
  assert.ok(median.lng > 0.5 && median.lng < 1.5);
});

test('generateMeetingCandidates tạo 8 điểm duy nhất', () => {
  const candidates = generateMeetingCandidates({
    people: [
      { lat: 0, lng: -0.01 },
      { lat: 0, lng: 0.01 },
    ],
    radiusM: 3_000,
  });

  assert.equal(candidates.length, 8);
  const keys = new Set(
    candidates.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`),
  );
  assert.equal(keys.size, candidates.length);
  assert.ok(candidates.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)));
});

test('chooseMeetingPoint chọn điểm có thời gian xa nhất nhỏ nhất', () => {
  const candidates = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 0, lng: 2 },
  ];
  const rows = [
    {
      elements: [
        { status: 'OK', distanceMeters: 1_000, durationSeconds: 600 },
        { status: 'OK', distanceMeters: 800, durationSeconds: 300 },
        { status: 'OK', distanceMeters: 900, durationSeconds: 400 },
      ],
    },
    {
      elements: [
        { status: 'OK', distanceMeters: 1_000, durationSeconds: 600 },
        { status: 'OK', distanceMeters: 800, durationSeconds: 350 },
        { status: 'OK', distanceMeters: 900, durationSeconds: 420 },
      ],
    },
    {
      elements: [
        { status: 'OK', distanceMeters: 1_000, durationSeconds: 600 },
        { status: 'OK', distanceMeters: 800, durationSeconds: 330 },
        { status: 'OK', distanceMeters: 900, durationSeconds: 410 },
      ],
    },
  ];

  const best = chooseMeetingPoint(candidates, rows);
  assert.equal(best.lng, 1);
  assert.equal(best.maxDuration, 350);
  assert.equal(best.spreadSeconds, 50);
});

test('chooseMeetingPoint bỏ qua điểm không có tuyến cho mọi người', () => {
  const candidates = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
  ];
  const rows = [
    {
      elements: [
        { status: 'OK', distanceMeters: 1_000, durationSeconds: 300 },
        { status: 'ZERO_RESULTS', distanceMeters: null, durationSeconds: null },
      ],
    },
    {
      elements: [
        { status: 'OK', distanceMeters: 1_000, durationSeconds: 320 },
        { status: 'ZERO_RESULTS', distanceMeters: null, durationSeconds: null },
      ],
    },
  ];

  const best = chooseMeetingPoint(candidates, rows);
  assert.equal(best.lng, 0);
});
