import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline } from '../public/js/polyline.js';

test('decodePolyline giải mã chuỗi mẫu của Google', () => {
  const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(points.length, 3);
  assert.deepEqual(points[0], [-120.2, 38.5]);
  assert.deepEqual(points[1], [-120.95, 40.7]);
  assert.deepEqual(points[2], [-126.453, 43.252]);
});

test('decodePolyline trả mảng rỗng với giá trị rỗng', () => {
  assert.deepEqual(decodePolyline(''), []);
  assert.deepEqual(decodePolyline(null), []);
});
