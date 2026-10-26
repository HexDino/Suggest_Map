import test from 'node:test';
import assert from 'node:assert/strict';
import { routeOf } from '../functions/route.js';

test('routeOf nhận path logic của Qoder Sites', () => {
  assert.equal(routeOf('/functions/v1/app/config'), '/config');
  assert.equal(routeOf('/functions/v1/physical/places/autocomplete'), '/places/autocomplete');
  assert.equal(routeOf('/functions/v1/app'), '/');
});

test('routeOf hỗ trợ path rút gọn và /api khi chạy local', () => {
  assert.equal(routeOf('/app/health'), '/health');
  assert.equal(routeOf('/api/discover'), '/discover');
  assert.equal(routeOf('/config'), '/config');
  assert.equal(routeOf('/functions/v1/app/api/config'), '/config');
});
