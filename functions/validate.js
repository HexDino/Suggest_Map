const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const NUM = String.raw`-?\d{1,3}(?:\.\d+)?`;
const COORD_RE = new RegExp(`^(${NUM}),(${NUM})$`);
const LL_RE = new RegExp(`^@?(${NUM}),(${NUM}),(\\d{1,2})z$`);

export class ValidationError extends Error {
  constructor(message, code = 'INVALID_PARAM') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.status = 400;
  }
}

export function text(value, { name = 'value', min = 1, max = 100 } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${name} is required`);
  const cleaned = value.replace(CONTROL_CHARS, ' ').trim();
  if (cleaned.length < min || cleaned.length > max) {
    throw new ValidationError(`${name} must be ${min}-${max} characters`);
  }
  return cleaned;
}

export function coordinate(value, name = 'location') {
  if (typeof value !== 'string') throw new ValidationError(`${name} is required`);
  const match = value.trim().match(COORD_RE);
  if (!match) throw new ValidationError(`${name} must be lat,lng`);
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new ValidationError(`${name} is out of range`);
  }
  return { lat, lng };
}

export function coordinateList(value, { name = 'destinations', min = 1, max = 10 } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${name} is required`);
  const parts = value.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts.length < min || parts.length > max) {
    throw new ValidationError(`${name} must contain ${min}-${max} coordinates`);
  }
  return parts.map((part) => coordinate(part, name));
}

export function number(value, { name = 'value', min = -Infinity, max = Infinity, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new ValidationError(`${name} is required`);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ValidationError(`${name} must be a number`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

export function integer(value, { name = 'value', min = 1, max = 20, required = true } = {}) {
  const parsed = number(value, { name, min, max, required });
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) throw new ValidationError(`${name} must be an integer`);
  return parsed;
}

export function placeId(value) {
  if (typeof value !== 'string') throw new ValidationError('placeId is required');
  const id = value.trim();
  if (id.length < 8 || id.length > 300 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new ValidationError('placeId is invalid');
  }
  return id;
}

export function vehicle(value) {
  const normalized = value === undefined || value === '' ? 'car' : String(value).toLowerCase();
  if (!['car', 'bike', 'foot', 'truck'].includes(normalized)) {
    throw new ValidationError('vehicle is invalid');
  }
  return normalized;
}

export function ll(value) {
  if (typeof value !== 'string') throw new ValidationError('ll is required');
  const match = value.trim().match(LL_RE);
  if (!match) throw new ValidationError('ll must be @lat,lng,zoomz');
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  const zoom = Number(match[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new ValidationError('ll is out of range');
  }
  if (zoom < 8 || zoom > 18) throw new ValidationError('zoom must be between 8 and 18');
  return `@${lat},${lng},${zoom}z`;
}
