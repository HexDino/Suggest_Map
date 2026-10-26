import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coordinate,
  coordinateList,
  integer,
  ll,
  number,
  placeId,
  text,
  vehicle,
  ValidationError,
} from '../server/validate.js';

test('coordinate chấp nhận lat,lng hợp lệ', () => {
  assert.deepEqual(coordinate('21.03,105.85'), { lat: 21.03, lng: 105.85 });
  assert.throws(() => coordinate('91,105'), ValidationError);
  assert.throws(() => coordinate('abc'), ValidationError);
});

test('coordinateList tách bằng dấu | và giới hạn số điểm', () => {
  assert.equal(coordinateList('1,2|3,4', { max: 2 }).length, 2);
  assert.throws(() => coordinateList('1,2|3,4|5,6', { max: 2 }), ValidationError);
});

test('ll chuẩn hóa chuỗi cho SerpApi', () => {
  assert.equal(ll('21.03,105.85,15z'), '@21.03,105.85,15z');
  assert.equal(ll('@21.03,105.85,15z'), '@21.03,105.85,15z');
  assert.throws(() => ll('21.03,105.85,19z'), ValidationError);
});

test('placeId chỉ nhận ký tự an toàn', () => {
  assert.equal(placeId('abcdefghij'), 'abcdefghij');
  assert.throws(() => placeId('abc'), ValidationError);
  assert.throws(() => placeId('abc def ghi'), ValidationError);
});

test('vehicle chỉ nhận giá trị cho phép', () => {
  assert.equal(vehicle('CAR'), 'car');
  assert.equal(vehicle(undefined), 'car');
  assert.throws(() => vehicle('plane'), ValidationError);
});

test('text làm sạch ký tự điều khiển', () => {
  assert.equal(text('  quán\u0000ăn  ', { max: 20 }), 'quán ăn');
  assert.throws(() => text('', { max: 20 }), ValidationError);
  assert.throws(() => text('a'.repeat(21), { max: 20 }), ValidationError);
});

test('number và integer kiểm tra miền giá trị', () => {
  assert.equal(number('3', { min: 1, max: 5 }), 3);
  assert.throws(() => number('9', { min: 1, max: 5 }), ValidationError);
  assert.throws(() => integer('2.5'), ValidationError);
  assert.equal(integer('4'), 4);
});
