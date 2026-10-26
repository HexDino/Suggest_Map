import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachTravel,
  fairness,
  preRank,
  sortResults,
} from '../public/js/ranking.js';

const midpoint = { lat: 0, lng: 0 };
const a = { lat: -0.01, lng: 0 };
const b = { lat: 0.01, lng: 0 };

function place(overrides = {}) {
  return {
    googlePlaceId: 'test',
    name: 'Quán',
    lat: 0,
    lng: 0.001,
    rating: 4.5,
    ...overrides,
  };
}

test('preRank lọc theo bán kính và xếp theo điểm sơ bộ', () => {
  const near = place({ name: 'Gần', lng: 0.001 });
  const far = place({ name: 'Xa', lng: 0.2 });
  const results = preRank([near, far], {
    midpoint,
    a,
    b,
    radiusM: 3_000,
    limit: 8,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Gần');
  assert.ok(results[0].distanceMid > 0);
  assert.ok('prelimScore' in results[0]);
});

test('preRank tôn trọng giới hạn kết quả', () => {
  const places = Array.from({ length: 12 }, (_, index) =>
    place({ name: `Quán ${index}`, lng: 0.0001 * (index + 1) }),
  );
  const results = preRank(places, {
    midpoint,
    a,
    b,
    radiusM: 5_000,
    limit: 6,
  });
  assert.equal(results.length, 6);
});

test('attachTravel ghép quãng đường và thời gian cho hai người', () => {
  const places = [place({ name: 'Một' }), place({ name: 'Hai' })];
  const rows = [
    {
      elements: [
        { status: 'OK', distanceMeters: 1_000, durationSeconds: 300 },
        { status: 'OK', distanceMeters: 1_200, durationSeconds: 360 },
      ],
    },
    {
      elements: [
        { status: 'OK', distanceMeters: 1_100, durationSeconds: 330 },
        { status: 'ZERO_RESULTS', distanceMeters: null, durationSeconds: null },
      ],
    },
  ];

  const [first, second] = attachTravel(places, rows);
  assert.equal(first.hasTravel, true);
  assert.equal(first.balanceSeconds, 30);
  assert.equal(second.hasTravel, false);
  assert.equal(second.travelB, null);
});

test('sortResults cân bằng xếp trước, rồi tổng thời gian', () => {
  const places = attachTravel(
    [place({ name: 'Lệch' }), place({ name: 'Cân bằng' }), place({ name: 'Nhanh' })],
    [
      {
        elements: [
          { status: 'OK', distanceMeters: 1_000, durationSeconds: 300 },
          { status: 'OK', distanceMeters: 1_000, durationSeconds: 300 },
          { status: 'OK', distanceMeters: 900, durationSeconds: 200 },
        ],
      },
      {
        elements: [
          { status: 'OK', distanceMeters: 1_000, durationSeconds: 600 },
          { status: 'OK', distanceMeters: 1_000, durationSeconds: 330 },
          { status: 'OK', distanceMeters: 1_200, durationSeconds: 400 },
        ],
      },
    ],
  );

  assert.equal(sortResults(places, 'balance')[0].name, 'Cân bằng');
  assert.equal(sortResults(places, 'total')[0].name, 'Nhanh');
});

test('fairness trả nhãn cân bằng hoặc lệch', () => {
  const balanced = {
    hasTravel: true,
    travelA: { durationSeconds: 300 },
    travelB: { durationSeconds: 360 },
    balanceSeconds: 60,
  };
  const uneven = {
    hasTravel: true,
    travelA: { durationSeconds: 300 },
    travelB: { durationSeconds: 600 },
    balanceSeconds: 300,
  };

  assert.equal(fairness(balanced).tone, 'good');
  assert.match(fairness(uneven).label, /Lệch/);
});
