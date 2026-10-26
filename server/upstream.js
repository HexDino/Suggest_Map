export class UpstreamError extends Error {
  constructor(message, { status = 502, code = 'UPSTREAM_ERROR' } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.code = code;
  }
}

function errorCode(error) {
  if (!error) return null;
  if (typeof error === 'string') return 'UPSTREAM_ERROR';
  return error.code || 'UPSTREAM_ERROR';
}

export async function fetchJson(url, { timeoutMs = 15_000, signal } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response;
  try {
    response = await fetch(url, {
      signal: combined,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error.name === 'TimeoutError') {
      throw new UpstreamError('Upstream timed out', { code: 'UPSTREAM_TIMEOUT' });
    }
    throw new UpstreamError('Upstream is unreachable', { code: 'UPSTREAM_UNREACHABLE' });
  }

  let body;
  try {
    body = await response.text();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new UpstreamError('Upstream response was interrupted');
  }

  let data = null;
  if (body) {
    try {
      data = JSON.parse(body);
    } catch {
      throw new UpstreamError('Upstream returned invalid JSON');
    }
  }

  if (!response.ok) {
    const quota = response.status === 429 || errorCode(data?.error) === 'API_KEY_INVALID';
    throw new UpstreamError('Upstream request failed', {
      code: quota ? 'UPSTREAM_LIMIT' : errorCode(data?.error) || 'UPSTREAM_ERROR',
    });
  }

  if (data?.error) {
    throw new UpstreamError('Upstream request failed', {
      code: errorCode(data.error),
    });
  }

  return data;
}
