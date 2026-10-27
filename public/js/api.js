export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const API_BASE = '/functions/v1/app';
const REQUEST_TIMEOUT_MS = 35_000;

function apiPath(path) {
  const suffix = path.startsWith('/api') ? path.slice(4) : path;
  return `${API_BASE}${suffix || '/'}`;
}

function withTimeout(signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort(signal?.reason);

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

export async function getJson(path, params = {}, signal) {
  const url = new URL(apiPath(path), window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const request = withTimeout(signal);
  let response;
  try {
    response = await fetch(url, {
      signal: request.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error.name === 'TimeoutError') throw new ApiError('REQUEST_TIMEOUT', 0);
    throw new ApiError('NETWORK_ERROR', 0);
  } finally {
    request.cleanup();
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new ApiError(data?.error?.code || 'REQUEST_FAILED', response.status);
  }

  return data;
}
