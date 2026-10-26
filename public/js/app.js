import { getJson } from './api.js';
import { createAutocomplete } from './autocomplete.js';
import {
  formatDistance,
  formatDuration,
  formatRating,
  formatReviews,
} from './format.js';
import { midpoint, zoomForRadius } from './geo.js';
import { MapView } from './map.js';
import { decodePolyline } from './polyline.js';
import { attachTravel, fairness, preRank, sortResults } from './ranking.js';

const form = document.querySelector('#search-form');
const inputA = document.querySelector('#location-a');
const inputB = document.querySelector('#location-b');
const suggestionsA = document.querySelector('#suggestions-a');
const suggestionsB = document.querySelector('#suggestions-b');
const statusA = document.querySelector('#status-a');
const statusB = document.querySelector('#status-b');
const fieldA = document.querySelector('.location-field[data-side="a"]');
const fieldB = document.querySelector('.location-field[data-side="b"]');
const keywordInput = document.querySelector('#keyword');
const chipList = document.querySelector('#keyword-chips');
const radiusInput = document.querySelector('#radius');
const radiusValue = document.querySelector('#radius-value');
const searchButton = document.querySelector('#search-btn');
const searchLabel = searchButton.querySelector('span');
const resultsList = document.querySelector('#results-list');
const resultsSummary = document.querySelector('#results-summary');
const sortControl = document.querySelector('#sort-control');
const sortTrigger = document.querySelector('#sort-trigger');
const sortValue = document.querySelector('#sort-value');
const sortMenu = document.querySelector('#sort-menu');
const sortOptions = [...sortMenu.querySelectorAll('.sort-option')];
const swapButton = document.querySelector('#swap-btn');
const mapOverlay = document.querySelector('#map-overlay');
const mapOverlayText = document.querySelector('#map-overlay-text');
const mapRetry = document.querySelector('#map-retry');

const sides = {
  a: {
    input: inputA,
    field: fieldA,
    status: statusA,
    suggestions: suggestionsA,
  },
  b: {
    input: inputB,
    field: fieldB,
    status: statusB,
    suggestions: suggestionsB,
  },
};

const state = {
  a: { label: '', placeId: null, coords: null },
  b: { label: '', placeId: null, coords: null },
  keyword: 'quán ăn',
  radiusKm: 3,
  midpoint: null,
  results: [],
  sort: 'balance',
  selectedIndex: null,
  searched: false,
  loading: false,
  seq: 0,
};

const routeCache = new Map();
let searchAbort = null;
let routeAbort = null;
let routeSeq = 0;

const mapView = new MapView(document.querySelector('#map'), {
  onMarkerClick: (index) => selectResult(index),
  onReady: () => {
    mapOverlay.hidden = true;
  },
  onError: (error) => {
    console.error('Map error', error);
    showMapError();
  },
});

function showMapError() {
  mapOverlay.hidden = false;
  mapOverlayText.textContent = 'Không tải được bản đồ.';
  mapRetry.hidden = false;
}

function clearStatus(side) {
  const { field, status } = sides[side];
  field.classList.remove('is-invalid');
  status.replaceChildren();
}

function setFieldLoading(side, message = 'Đang xác định vị trí…') {
  const { field, status } = sides[side];
  field.classList.remove('is-invalid');
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  status.replaceChildren(spinner, document.createTextNode(message));
}

function setFieldError(side, message, retry) {
  const { field, status } = sides[side];
  field.classList.add('is-invalid');
  const textNode = document.createTextNode(`${message} `);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inline-retry';
  button.textContent = 'Thử lại';
  button.addEventListener('click', retry);
  status.replaceChildren(textNode, button);
}

function setFieldHint(side, message) {
  const { field, status } = sides[side];
  field.classList.add('is-invalid');
  status.replaceChildren(document.createTextNode(message));
}

function updateSearchButton() {
  if (state.loading) return;
  searchLabel.textContent = state.searched ? 'Tìm lại' : 'Tìm điểm hẹn';
}

function updateChips() {
  const value = keywordInput.value.trim().toLowerCase();
  for (const chip of chipList.querySelectorAll('.chip')) {
    chip.classList.toggle('is-active', chip.dataset.keyword === value);
  }
}

const SORT_LABELS = {
  balance: 'Cân bằng nhất',
  midpoint: 'Gần điểm giữa',
  total: 'Tổng thời gian thấp nhất',
};

function openSortMenu() {
  if (sortTrigger.disabled) return;
  sortMenu.hidden = false;
  sortControl.classList.add('is-open');
  sortTrigger.setAttribute('aria-expanded', 'true');
  const selected = sortOptions.find((option) => option.dataset.value === state.sort);
  (selected || sortOptions[0])?.focus();
}

function closeSortMenu({ focusTrigger = false } = {}) {
  if (sortMenu.hidden) return;
  sortMenu.hidden = true;
  sortControl.classList.remove('is-open');
  sortTrigger.setAttribute('aria-expanded', 'false');
  sortOptions.forEach((option) => option.classList.remove('is-active'));
  if (focusTrigger) sortTrigger.focus();
}

function toggleSortMenu() {
  if (sortMenu.hidden) openSortMenu();
  else closeSortMenu({ focusTrigger: true });
}

function applySort(value) {
  if (!SORT_LABELS[value]) return;

  state.sort = value;
  sortValue.textContent = SORT_LABELS[value];
  sortOptions.forEach((option) => {
    const selected = option.dataset.value === value;
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-selected', String(selected));
  });
  closeSortMenu({ focusTrigger: true });

  if (state.results.length > 0) {
    routeAbort?.abort();
    routeSeq += 1;
    state.results = sortResults(state.results, state.sort);
    state.selectedIndex = null;
    mapView.clearRoutes();
    mapView.setResults(state.results);
    renderResults();
  }
}

function setLoading(loading) {
  state.loading = loading;
  searchButton.disabled = loading;
  searchButton.classList.toggle('is-loading', loading);
  sortTrigger.disabled = loading;
  if (loading) {
    closeSortMenu();
    searchLabel.textContent = 'Đang tìm…';
    resultsSummary.textContent = 'Đang tìm quán quanh điểm giữa…';
    renderSkeletons();
  } else {
    updateSearchButton();
  }
}

function syncEndpoints({ fit = false } = {}) {
  const a = state.a.coords;
  const b = state.b.coords;
  const mid = a && b ? midpoint(a, b) : null;
  state.midpoint = mid;

  mapView.setEndpoints({
    a,
    b,
    midpoint: mid,
    radiusM: mid ? state.radiusKm * 1000 : null,
  });

  if (fit && a && b) {
    mapView.fitSearch();
  }
}

function cancelActiveSearch() {
  searchAbort?.abort();
  searchAbort = null;
  state.seq += 1;
  if (state.loading) setLoading(false);
}

function restoreResults() {
  if (state.results.length > 0) renderResults();
  else renderIntro();
}

function clearResults() {
  cancelActiveSearch();
  state.results = [];
  state.selectedIndex = null;
  state.searched = false;
  routeAbort?.abort();
  routeSeq += 1;
  mapView.setResults([]);
  mapView.clearRoutes();
  renderIntro();
  updateSearchButton();
}

function handleLocationEdit(side) {
  state[side] = { label: sides[side].input.value, placeId: null, coords: null };
  clearStatus(side);
  syncEndpoints();
  clearResults();
}

async function loadDetail(side) {
  const target = state[side];
  const id = target.placeId;
  if (!id) return;

  setFieldLoading(side);

  try {
    const data = await getJson('/api/places/detail', { placeId: id });
    if (state[side].placeId !== id) return;
    state[side].coords = { lat: data.place.lat, lng: data.place.lng };
    state[side].label = data.place.address || data.place.name || target.label;
    clearStatus(side);
    syncEndpoints({ fit: true });
    updateSearchButton();
  } catch {
    if (state[side].placeId !== id) return;
    setFieldError(side, 'Thử lại', () => loadDetail(side));
  }
}

function handlePrediction(side, prediction) {
  state[side] = {
    label: prediction.description,
    placeId: prediction.placeId,
    coords: null,
  };
  clearStatus(side);
  syncEndpoints();
  clearResults();
  updateSearchButton();
  loadDetail(side);
}

function setupAutocomplete(side) {
  createAutocomplete({
    input: sides[side].input,
    list: sides[side].suggestions,
    onSelect: (prediction) => handlePrediction(side, prediction),
    onDirty: () => handleLocationEdit(side),
  });
}

async function resolveInput(side, signal) {
  if (state[side].coords) return state[side];

  if (state[side].placeId) {
    setFieldLoading(side);
    try {
      const data = await getJson(
        '/api/places/detail',
        { placeId: state[side].placeId },
        signal,
      );
      state[side].coords = { lat: data.place.lat, lng: data.place.lng };
      state[side].label = data.place.address || data.place.name || state[side].label;
      clearStatus(side);
      syncEndpoints({ fit: true });
      return state[side];
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      setFieldError(side, 'Thử lại', () => resolveInput(side));
      throw error;
    }
  }

  const query = sides[side].input.value.trim();
  if (!query) {
    setFieldHint(side, 'Chọn một địa chỉ');
    throw new Error('MISSING_LOCATION');
  }

  setFieldLoading(side, 'Đang xác định địa chỉ…');
  try {
    const data = await getJson(
      '/api/places/autocomplete',
      { input: query, limit: 5 },
      signal,
    );
    const first = data.predictions?.[0];
    if (!first) {
      setFieldError(side, 'Thử lại', () => resolveInput(side));
      throw new Error('LOCATION_NOT_FOUND');
    }

    state[side] = {
      label: first.description,
      placeId: first.placeId,
      coords: null,
    };
    sides[side].input.value = first.description;

    const detail = await getJson(
      '/api/places/detail',
      { placeId: first.placeId },
      signal,
    );
    state[side].coords = { lat: detail.place.lat, lng: detail.place.lng };
    state[side].label = detail.place.address || first.description;
    clearStatus(side);
    syncEndpoints({ fit: true });
    return state[side];
  } catch (error) {
    if (error.name === 'AbortError' || error.message === 'LOCATION_NOT_FOUND') {
      throw error;
    }
    setFieldError(side, 'Thử lại', () => resolveInput(side));
    throw error;
  }
}

function activateLocation(side) {
  const button = document.querySelector(`[data-locate="${side}"]`);
  if (!navigator.geolocation) return;

  button.classList.add('is-loading');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      button.classList.remove('is-loading');
      state[side] = {
        label: 'Vị trí hiện tại',
        placeId: null,
        coords: {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        },
      };
      sides[side].input.value = 'Vị trí hiện tại';
      clearStatus(side);
      syncEndpoints({ fit: true });
      clearResults();
      updateSearchButton();
    },
    () => {
      button.classList.remove('is-loading');
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  );
}

function renderIntro() {
  resultsSummary.textContent = 'Nhập A và B để bắt đầu';
  const card = document.createElement('div');
  card.className = 'intro-card';
  const title = document.createElement('h3');
  title.textContent = 'Chọn điểm hẹn cho hai người';
  const description = document.createElement('p');
  description.textContent =
    'Nhập địa chỉ của A và B, chọn món bạn muốn ăn. Ứng dụng sẽ tìm quán ở khoảng giữa và cân thời gian đi lại cho cả hai.';
  card.append(title, description);
  resultsList.replaceChildren(card);
}

function renderSkeletons() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 3; index += 1) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    const top = document.createElement('div');
    top.className = 'skeleton-top';

    const thumb = document.createElement('div');
    thumb.className = 'skeleton-thumb skeleton-shimmer';

    const lines = document.createElement('div');
    lines.className = 'skeleton-lines';
    for (const width of ['medium', 'short', 'long']) {
      const line = document.createElement('div');
      line.className = `skeleton-line skeleton-shimmer ${width}`;
      lines.append(line);
    }

    top.append(thumb, lines);
    card.append(top);
    fragment.append(card);
  }
  resultsList.replaceChildren(fragment);
}

function scrollToResultsOnMobile() {
  if (!window.matchMedia('(max-width: 860px)').matches) return;
  document.querySelector('.results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSearchError() {
  resultsSummary.textContent = '';
  const card = document.createElement('div');
  card.className = 'state-card';
  const message = document.createElement('p');
  message.textContent = 'Không tải được gợi ý.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'state-action';
  retry.textContent = 'Thử lại';
  retry.addEventListener('click', () => runSearch());
  card.append(message, retry);
  resultsList.replaceChildren(card);
  scrollToResultsOnMobile();
}

function renderEmpty() {
  resultsSummary.textContent = `0 gợi ý trong ${formatDistance(state.radiusKm * 1000)}`;
  const card = document.createElement('div');
  card.className = 'state-card';
  const message = document.createElement('p');
  message.textContent = 'Chưa có quán phù hợp trong bán kính này.';

  card.append(message);

  if (state.radiusKm < 10) {
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'state-action';
    expand.textContent = 'Mở rộng bán kính';
    expand.addEventListener('click', () => {
      state.radiusKm = Math.min(10, state.radiusKm + 2);
      radiusInput.value = String(state.radiusKm);
      radiusValue.textContent = `${state.radiusKm} km`;
      syncEndpoints();
      runSearch();
    });
    card.append(expand);
  }

  resultsList.replaceChildren(card);
}

function mapsUrl(place) {
  if (place.googlePlaceId) {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.googlePlaceId)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
}

function metaItem(text, className = '') {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

function createCard(place, index) {
  const card = document.createElement('article');
  card.className = 'result-card';
  card.dataset.index = String(index);
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Xem gợi ý ${index + 1}: ${place.name}`);
  card.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) return;
    selectResult(index);
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectResult(index);
    }
  });

  const top = document.createElement('div');
  top.className = 'result-top';

  const rank = document.createElement('span');
  rank.className = 'result-rank';
  rank.textContent = String(index + 1);
  top.append(rank);

  if (place.thumbnail) {
    const image = document.createElement('img');
    image.className = 'result-thumb';
    image.src = place.thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove());
    top.append(image);
  }

  const info = document.createElement('div');
  info.className = 'result-info';

  const name = document.createElement('h3');
  name.className = 'result-name';
  name.textContent = place.name;
  info.append(name);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  if (place.type) meta.append(metaItem(place.type));
  if (Number.isFinite(place.rating)) {
    meta.append(metaItem(`★ ${formatRating(place.rating)}`, 'rating'));
    if (Number.isFinite(place.reviews)) {
      meta.append(metaItem(`(${formatReviews(place.reviews)})`));
    }
  }
  if (place.openState) {
    let className = 'open-state';
    if (place.openState.includes('Đang mở cửa')) className += ' is-open';
    if (place.openState.includes('Sắp đóng cửa')) className += ' is-closing';
    meta.append(metaItem(place.openState, className));
  }
  if (meta.childElementCount > 0) info.append(meta);

  if (place.address) {
    const address = document.createElement('p');
    address.className = 'result-address';
    address.textContent = place.address;
    info.append(address);
  }

  top.append(info);

  const badgeInfo = fairness(place);
  const badge = document.createElement('span');
  badge.className = `badge ${badgeInfo.tone}`;
  badge.textContent = badgeInfo.label;
  top.append(badge);

  card.append(top);

  if (place.hasTravel) {
    const travel = document.createElement('div');
    travel.className = 'travel-grid';

    for (const [side, label, leg] of [
      ['a', 'A', place.travelA],
      ['b', 'B', place.travelB],
    ]) {
      const item = document.createElement('div');
      item.className = 'travel-item';
      const dot = document.createElement('span');
      dot.className = `dot dot-${side}`;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'travel-name';
      nameSpan.textContent = label;
      const value = document.createElement('span');
      value.className = 'travel-value';
      value.textContent = `${formatDistance(leg.distanceMeters)} · ${formatDuration(leg.durationSeconds)}`;
      item.append(dot, nameSpan, value);
      travel.append(item);
    }

    card.append(travel);
  }

  const midpointLine = document.createElement('p');
  midpointLine.className = 'midpoint-line';
  midpointLine.textContent = `Cách điểm giữa ${formatDistance(place.distanceMid)}`;
  card.append(midpointLine);

  const actions = document.createElement('div');
  actions.className = 'result-actions';

  const routeButton = document.createElement('button');
  routeButton.type = 'button';
  routeButton.className = 'text-btn route-btn';
  routeButton.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19c4 0 4-14 8-14s4 14 8 14"></path></svg><span>Chỉ đường</span>';
  routeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    selectResult(index);
  });
  actions.append(routeButton);

  const link = document.createElement('a');
  link.className = 'text-link';
  link.href = mapsUrl(place);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7M10 14 21 3M21 14v7H3V3h7"></path></svg><span>Google Maps</span>';
  actions.append(link);

  card.append(actions);
  return card;
}

function renderResults() {
  if (state.results.length === 0) {
    renderEmpty();
    return;
  }

  resultsSummary.textContent = `${state.results.length} gợi ý trong ${formatDistance(state.radiusKm * 1000)}`;
  const fragment = document.createDocumentFragment();
  state.results.forEach((place, index) => fragment.append(createCard(place, index)));
  resultsList.replaceChildren(fragment);
}

function updateSelectedCards() {
  for (const card of resultsList.querySelectorAll('.result-card')) {
    card.classList.toggle('is-selected', Number(card.dataset.index) === state.selectedIndex);
  }
}

function resetRouteButton() {
  const button = resultsList.querySelector('.result-card.is-selected .route-btn');
  if (!button) return;
  button.disabled = false;
  button.querySelector('span').textContent = 'Chỉ đường';
}

function coordKey(point) {
  return `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
}

async function getRoute(origin, destination, signal) {
  const key = `${coordKey(origin)}:${coordKey(destination)}`;
  const cached = routeCache.get(key);
  if (cached) return cached;

  const data = await getJson(
    '/api/places/directions',
    {
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      vehicle: 'car',
    },
    signal,
  );

  if (routeCache.size >= 100) {
    routeCache.delete(routeCache.keys().next().value);
  }
  routeCache.set(key, data.route);
  return data.route;
}

async function drawRoutes(index) {
  const place = state.results[index];
  const a = state.a.coords;
  const b = state.b.coords;
  if (!place || !a || !b) return;

  routeAbort?.abort();
  const controller = new AbortController();
  routeAbort = controller;
  const token = ++routeSeq;

  const button = resultsList.querySelector('.result-card.is-selected .route-btn');
  if (button) {
    button.disabled = true;
    button.querySelector('span').textContent = 'Đang vẽ…';
  }

  try {
    const routeA = await getRoute(a, place, controller.signal);
    if (token !== routeSeq) return;
    const routeB = await getRoute(b, place, controller.signal);
    if (token !== routeSeq) return;

    mapView.drawRoutes({
      a: routeA?.polyline ? decodePolyline(routeA.polyline) : [],
      b: routeB?.polyline ? decodePolyline(routeB.polyline) : [],
    });
  } catch (error) {
    if (error.name !== 'AbortError' && token === routeSeq) {
      mapView.clearRoutes();
    }
  } finally {
    if (token === routeSeq) resetRouteButton();
  }
}

function selectResult(index) {
  state.selectedIndex = index;
  mapView.selectResult(index);
  updateSelectedCards();

  const card = resultsList.querySelector(`.result-card[data-index="${index}"]`);
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  drawRoutes(index);
}

async function runSearch() {
  if (state.loading) return;

  searchAbort?.abort();
  const controller = new AbortController();
  searchAbort = controller;
  const seq = ++state.seq;

  setLoading(true);
  routeAbort?.abort();
  routeSeq += 1;
  state.selectedIndex = null;
  mapView.clearRoutes();

  try {
    const a = await resolveInput('a', controller.signal);
    if (seq !== state.seq) return;
    const b = await resolveInput('b', controller.signal);
    if (seq !== state.seq) return;

    const mid = midpoint(a.coords, b.coords);
    const radiusM = state.radiusKm * 1000;
    const keyword = keywordInput.value.trim() || 'quán ăn';

    state.keyword = keyword;
    state.midpoint = mid;
    syncEndpoints();
    mapView.setEndpoints({
      a: a.coords,
      b: b.coords,
      midpoint: mid,
      radiusM,
    });

    const discover = await getJson(
      '/api/discover',
      {
        q: keyword,
        ll: `@${mid.lat.toFixed(6)},${mid.lng.toFixed(6)},${zoomForRadius(state.radiusKm)}z`,
      },
      controller.signal,
    );
    if (seq !== state.seq) return;

    const prepared = preRank(discover.places || [], {
      midpoint: mid,
      a: a.coords,
      b: b.coords,
      radiusM,
      limit: 8,
    });

    if (prepared.length === 0) {
      state.results = [];
      state.searched = true;
      renderResults();
      mapView.setResults([]);
      mapView.fitSearch();
      scrollToResultsOnMobile();
      return;
    }

    let results = prepared;

    try {
      const matrix = await getJson(
        '/api/places/matrix',
        {
          origins: `${a.coords.lat},${a.coords.lng}|${b.coords.lat},${b.coords.lng}`,
          destinations: prepared.map((place) => `${place.lat},${place.lng}`).join('|'),
          vehicle: 'car',
        },
        controller.signal,
      );
      if (seq !== state.seq) return;
      results = attachTravel(prepared, matrix.rows);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
    }

    state.results = sortResults(results, state.sort);
    state.selectedIndex = null;
    state.searched = true;
    renderResults();
    mapView.setResults(state.results);
    mapView.fitSearch();
    scrollToResultsOnMobile();
  } catch (error) {
    if (error.name === 'AbortError' || seq !== state.seq) return;
    if (error.message === 'MISSING_LOCATION') {
      restoreResults();
      const firstEmpty = !state.a.coords ? inputA : !state.b.coords ? inputB : null;
      firstEmpty?.focus();
      return;
    }
    renderSearchError();
  } finally {
    if (seq === state.seq) {
      setLoading(false);
      searchAbort = null;
    }
  }
}

function initialize() {
  renderIntro();
  setupAutocomplete('a');
  setupAutocomplete('b');
  updateChips();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });

  for (const chip of chipList.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      keywordInput.value = chip.dataset.keyword;
      updateChips();
      updateSearchButton();
    });
  }

  keywordInput.addEventListener('input', () => {
    updateChips();
    updateSearchButton();
  });

  radiusInput.addEventListener('input', () => {
    state.radiusKm = Number(radiusInput.value);
    radiusValue.textContent = `${state.radiusKm} km`;
    syncEndpoints();
    updateSearchButton();
  });

  sortTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleSortMenu();
  });

  sortTrigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openSortMenu();
    }
  });

  sortOptions.forEach((option) => {
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      applySort(option.dataset.value);
    });
  });

  sortMenu.addEventListener('keydown', (event) => {
    const currentIndex = sortOptions.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      sortOptions[Math.min(currentIndex + 1, sortOptions.length - 1)]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      sortOptions[Math.max(currentIndex - 1, 0)]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSortMenu({ focusTrigger: true });
    } else if (event.key === 'Tab') {
      closeSortMenu();
    }
  });

  document.addEventListener('click', (event) => {
    if (!sortControl.contains(event.target)) closeSortMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !sortMenu.hidden) {
      closeSortMenu({ focusTrigger: true });
    }
  });

  swapButton.addEventListener('click', () => {
    const previousA = state.a;
    state.a = state.b;
    state.b = previousA;

    const valueA = inputA.value;
    inputA.value = inputB.value;
    inputB.value = valueA;

    clearStatus('a');
    clearStatus('b');
    syncEndpoints({ fit: true });
    clearResults();
    updateSearchButton();
  });

  for (const button of document.querySelectorAll('[data-locate]')) {
    button.addEventListener('click', () => activateLocation(button.dataset.locate));
  }

  mapRetry.addEventListener('click', () => window.location.reload());

  getJson('/api/config')
    .then((config) => {
      mapView.init({
        style: config.mapStyle,
        center: config.center,
        zoom: config.zoom,
      });
    })
    .catch((error) => {
      console.error('Map init failed', error);
      showMapError();
    });
}

initialize();
