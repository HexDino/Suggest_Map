import { circlePolygon } from './geo.js';

const maplibregl = window.maplibregl;
const EMPTY = { type: 'FeatureCollection', features: [] };

function pinElement(className, text, label) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', label);
  return element;
}

function lineFeature(coordinates) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  };
}

export class MapView {
  constructor(container, { onMarkerClick, onReady, onError } = {}) {
    this.container = container;
    this.onMarkerClick = onMarkerClick;
    this.onReady = onReady;
    this.onError = onError;
    this.map = null;
    this.ready = false;
    this.endpoints = null;
    this.results = [];
    this.endpointMarkers = { a: null, b: null, mid: null };
    this.resultMarkers = [];
    this.selected = null;
  }

  init({ style, center, zoom }) {
    if (!maplibregl) throw new Error('MapLibre is unavailable');

    this.map = new maplibregl.Map({
      container: this.container,
      style,
      center: [center.lng, center.lat],
      zoom,
      attributionControl: false,
    });

    this.map.on('styleimagemissing', (event) => {
      if (this.map.hasImage(event.id)) return;
      this.map.addImage(event.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });

    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: 'Goong' }),
      'bottom-right',
    );

    const timeout = setTimeout(() => {
      if (!this.ready) this.onError?.(new Error('Map timed out'));
    }, 15_000);

    this.map.on('load', () => {
      clearTimeout(timeout);
      this.ready = true;
      this.addLayers();
      if (this.endpoints) this.applyEndpoints();
      if (this.results.length > 0) this.applyResults();
      this.onReady?.();
    });

    this.map.on('error', (event) => {
      if (!this.ready) this.onError?.(event.error || new Error('Map failed'));
    });

    window.addEventListener('resize', () => this.map?.resize());
  }

  addLayers() {
    this.map.addSource('search-radius', { type: 'geojson', data: EMPTY });
    this.map.addLayer({
      id: 'search-radius-fill',
      type: 'fill',
      source: 'search-radius',
      paint: { 'fill-color': '#c8512f', 'fill-opacity': 0.08 },
    });
    this.map.addLayer({
      id: 'search-radius-line',
      type: 'line',
      source: 'search-radius',
      paint: {
        'line-color': '#c8512f',
        'line-opacity': 0.55,
        'line-width': 1.5,
        'line-dasharray': [3, 3],
      },
    });

    for (const side of ['a', 'b']) {
      this.map.addSource(`route-${side}`, { type: 'geojson', data: EMPTY });
      this.map.addLayer({
        id: `route-${side}-casing`,
        type: 'line',
        source: `route-${side}`,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fffdf9', 'line-width': 8, 'line-opacity': 0.95 },
      });
      this.map.addLayer({
        id: `route-${side}`,
        type: 'line',
        source: `route-${side}`,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': side === 'a' ? '#0f766e' : '#b45309',
          'line-width': 4.5,
          'line-opacity': 0.95,
        },
      });
    }
  }

  setEndpoints(endpoints) {
    this.endpoints = endpoints;
    if (this.ready) this.applyEndpoints();
  }

  applyEndpoints() {
    const { a, b, midpoint, radiusM } = this.endpoints || {};

    for (const side of ['a', 'b', 'mid']) {
      this.endpointMarkers[side]?.remove();
      this.endpointMarkers[side] = null;
    }

    if (a) {
      this.endpointMarkers.a = new maplibregl.Marker({
        element: pinElement('map-pin pin-a', 'A', 'Người A'),
      })
        .setLngLat([a.lng, a.lat])
        .addTo(this.map);
    }

    if (b) {
      this.endpointMarkers.b = new maplibregl.Marker({
        element: pinElement('map-pin pin-b', 'B', 'Người B'),
      })
        .setLngLat([b.lng, b.lat])
        .addTo(this.map);
    }

    if (midpoint) {
      const element = document.createElement('div');
      element.className = 'map-mid';
      element.setAttribute('aria-hidden', 'true');
      this.endpointMarkers.mid = new maplibregl.Marker({ element })
        .setLngLat([midpoint.lng, midpoint.lat])
        .addTo(this.map);
      this.map.getSource('search-radius')?.setData(circlePolygon(midpoint, radiusM));
    } else {
      this.map.getSource('search-radius')?.setData(EMPTY);
    }
  }

  setResults(results) {
    this.results = results;
    this.selected = null;
    if (this.ready) this.applyResults();
  }

  applyResults() {
    for (const marker of this.resultMarkers) marker.remove();
    this.resultMarkers = [];

    this.results.forEach((place, index) => {
      const element = pinElement('map-result', String(index + 1), `Gợi ý ${index + 1}: ${place.name}`);
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.addEventListener('click', () => this.onMarkerClick?.(index));
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.onMarkerClick?.(index);
        }
      });

      const marker = new maplibregl.Marker({ element })
        .setLngLat([place.lng, place.lat])
        .addTo(this.map);
      this.resultMarkers.push(marker);
    });
  }

  selectResult(index) {
    this.selected = index;
    this.resultMarkers.forEach((marker, markerIndex) => {
      marker.getElement().classList.toggle('is-selected', markerIndex === index);
    });
  }

  clearRoutes() {
    this.map?.getSource('route-a')?.setData(EMPTY);
    this.map?.getSource('route-b')?.setData(EMPTY);
  }

  drawRoutes(routes) {
    if (!this.ready) return;
    const routeA = routes.a?.length >= 2 ? lineFeature(routes.a) : EMPTY;
    const routeB = routes.b?.length >= 2 ? lineFeature(routes.b) : EMPTY;
    this.map.getSource('route-a')?.setData(routeA);
    this.map.getSource('route-b')?.setData(routeB);

    const coordinates = [...(routes.a || []), ...(routes.b || [])];
    if (this.endpoints?.a) coordinates.push([this.endpoints.a.lng, this.endpoints.a.lat]);
    if (this.endpoints?.b) coordinates.push([this.endpoints.b.lng, this.endpoints.b.lat]);
    if (coordinates.length === 0) return;

    const bounds = coordinates.reduce(
      (accumulator, coordinate) => accumulator.extend(coordinate),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );
    this.map.fitBounds(bounds, { padding: 56, maxZoom: 15.5, duration: 650 });
  }

  fitSearch() {
    if (!this.ready) return;
    const points = [];
    if (this.endpoints?.a) points.push([this.endpoints.a.lng, this.endpoints.a.lat]);
    if (this.endpoints?.b) points.push([this.endpoints.b.lng, this.endpoints.b.lat]);
    for (const place of this.results) points.push([place.lng, place.lat]);
    if (points.length === 0) return;

    const bounds = points.reduce(
      (accumulator, coordinate) => accumulator.extend(coordinate),
      new maplibregl.LngLatBounds(points[0], points[0]),
    );

    if (this.endpoints?.midpoint && this.endpoints?.radiusM) {
      const circle = circlePolygon(this.endpoints.midpoint, this.endpoints.radiusM, 24);
      for (const coordinate of circle.geometry.coordinates[0]) bounds.extend(coordinate);
    }

    this.map.fitBounds(bounds, { padding: 48, maxZoom: 15.2, duration: 700 });
  }
}
