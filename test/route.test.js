import test from 'node:test';
import assert from 'node:assert/strict';
import { routeOf } from '../functions/route.js';

test('routeOf nhận path logic của Qoder Sites', () => {
  assert.equal(routeOf('/functions/v1/app/config'), '/config');
  assert.equal(routeOf('/functions/v1/physical/places/autocomplete'), '/places/autocomplete');
  assert.equal(routeOf('/functions/v1/app'), '/');
});

test('routeOf nhận tên function vật lý trên runtime', () => {
  assert.equal(routeOf('/app-d01a1773/health'), '/health');
  assert.equal(routeOf('/app-d01a1773/places/detail'), '/places/detail');
  assert.equal(routeOf('/app-d01a1773/config'), '/config');
});

test('routeOf hỗ trợ path rút gọn và /api khi chạy local', () => {
  assert.equal(routeOf('/app/health'), '/health');
  assert.equal(routeOf('/api/discover'), '/discover');
  assert.equal(routeOf('/config'), '/config');
  assert.equal(routeOf('/functions/v1/app/api/config'), '/config');
});
