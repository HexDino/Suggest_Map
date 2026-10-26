export function routeOf(pathname) {
  const segments = (pathname || '/').split('/').filter(Boolean);
  let rest;

  if (segments[0] === 'functions' && segments[1] === 'v1' && segments.length >= 3) {
    rest = segments.slice(3);
  } else if (segments[0] === 'app') {
    rest = segments.slice(1);
  } else if (segments[0] === 'api') {
    rest = segments.slice(1);
  } else {
    rest = segments;
  }

  if (rest[0] === 'api') rest = rest.slice(1);

  const path = `/${rest.join('/')}`;
  return path === '/' ? '/' : path.replace(/\/+$/, '');
}
