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

function routeFeatures(routes) {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((route) => route.coordinates?.length >= 2)
      .map((route) => ({
        type: 'Feature',
        properties: { color: route.color },
        geometry: { type: 'LineString', coordinates: route.coordinates },
      })),
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
    this.personMarkers = [];
    this.midMarker = null;
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
      trackResize: false,
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

    this.map.addSource('person-routes', { type: 'geojson', data: EMPTY });
    this.map.addLayer({
      id: 'person-routes-casing',
      type: 'line',
      source: 'person-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fffdf9', 'line-width': 8, 'line-opacity': 0.95 },
    });
    this.map.addLayer({
      id: 'person-routes',
      type: 'line',
      source: 'person-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 4,
        'line-opacity': 0.95,
      },
    });
  }

  resize() {
    this.map?.resize();
  }

  fitPoints(people) {
    if (!this.ready || !people?.length) return;

    const coordinates = people.map((person) => [
      person.coords.lng,
      person.coords.lat,
    ]);
    if (coordinates.length === 1) {
      this.map.easeTo({
        center: coordinates[0],
        zoom: Math.max(this.map.getZoom(), 14),
        duration: 650,
      });
      return;
    }

    const bounds = coordinates.reduce(
      (accumulator, coordinate) => accumulator.extend(coordinate),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );
    const canvas = this.map.getCanvas();
    const padding = Math.max(
      16,
      Math.min(48, Math.floor(Math.min(canvas.clientWidth, canvas.clientHeight) * 0.15)),
    );
    this.map.fitBounds(bounds, { padding, maxZoom: 15.5, duration: 700 });
  }

  setEndpoints(endpoints) {
    this.endpoints = endpoints;
    if (this.ready) this.applyEndpoints();
  }

  applyEndpoints() {
    const { people = [], midpoint, radiusM } = this.endpoints || {};

    for (const marker of this.personMarkers) marker.remove();
    this.personMarkers = [];
    this.midMarker?.remove();
    this.midMarker = null;

    for (const person of people) {
      const element = pinElement('map-pin', person.label, `Người ${person.label}`);
      element.style.background = person.color;
      const marker = new maplibregl.Marker({ element })
        .setLngLat([person.coords.lng, person.coords.lat])
        .addTo(this.map);
      this.personMarkers.push(marker);
    }

    if (midpoint) {
      const element = document.createElement('div');
      element.className = 'map-mid';
      element.setAttribute('aria-hidden', 'true');
      this.midMarker = new maplibregl.Marker({ element })
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
      const element = pinElement(
        'map-result',
        String(index + 1),
        `Gợi ý ${index + 1}: ${place.name}`,
      );
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
    this.map?.getSource('person-routes')?.setData(EMPTY);
  }

  drawRoutes(routes) {
    if (!this.ready) return;

    const valid = routes.filter((route) => route.coordinates?.length >= 2);
    this.map.getSource('person-routes')?.setData(routeFeatures(valid));

    const coordinates = valid.flatMap((route) => route.coordinates);
    for (const person of this.endpoints?.people || []) {
      coordinates.push([person.coords.lng, person.coords.lat]);
    }
    if (coordinates.length === 0) return;

    const bounds = coordinates.reduce(
      (accumulator, coordinate) => accumulator.extend(coordinate),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );
    const canvas = this.map.getCanvas();
    const padding = Math.max(
      12,
      Math.min(56, Math.floor(Math.min(canvas.clientWidth, canvas.clientHeight) * 0.18)),
    );
    this.map.fitBounds(bounds, { padding, maxZoom: 15.5, duration: 650 });
  }

  fitSearch() {
    if (!this.ready) return;

    const points = [];
    for (const person of this.endpoints?.people || []) {
      points.push([person.coords.lng, person.coords.lat]);
    }
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

    const canvas = this.map.getCanvas();
    const padding = Math.max(
      12,
      Math.min(48, Math.floor(Math.min(canvas.clientWidth, canvas.clientHeight) * 0.15)),
    );
    this.map.fitBounds(bounds, { padding, maxZoom: 15.2, duration: 700 });
  }
}
