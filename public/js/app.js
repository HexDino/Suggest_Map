import { getJson } from './api.js';
import { createAutocomplete } from './autocomplete.js';
import {
  formatDistance,
  formatDuration,
  formatRating,
  formatReviews,
} from './format.js';
import { centroid, zoomForRadius } from './geo.js';
import { MapView } from './map.js';
import { chooseMeetingPoint, generateMeetingCandidates } from './meeting.js';
import { decodePolyline } from './polyline.js';
import { attachTravel, fairness, preRank, sortResults } from './ranking.js';

const MAX_PEOPLE = 6;
const PERSON_COLORS = {
  A: '#0f766e',
  B: '#b45309',
  C: '#4338ca',
  D: '#be123c',
  E: '#4d7c0f',
  F: '#7e22ce',
};
const LOCATE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"></path></svg>';
const REMOVE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>';

const form = document.querySelector('#search-form');
const peopleList = document.querySelector('#people-list');
const addPersonButton = document.querySelector('#add-person');
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
const mapOverlay = document.querySelector('#map-overlay');
const mapOverlayText = document.querySelector('#map-overlay-text');
const mapRetry = document.querySelector('#map-retry');
const appElement = document.querySelector('.app');
const sheetHandle = document.querySelector('#sheet-handle');

const state = {
  people: [],
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

function clearStatus(person) {
  person.field.classList.remove('is-invalid');
  person.status.replaceChildren();
}

function setFieldLoading(person, message = 'Đang xác định vị trí…') {
  person.field.classList.remove('is-invalid');
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  person.status.replaceChildren(spinner, document.createTextNode(message));
}

function setFieldError(person, message, retry) {
  person.field.classList.add('is-invalid');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inline-retry';
  button.textContent = 'Thử lại';
  button.addEventListener('click', retry);
  person.status.replaceChildren(document.createTextNode(`${message} `), button);
}

function setFieldHint(person, message) {
  person.field.classList.add('is-invalid');
  person.status.replaceChildren(document.createTextNode(message));
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
    resultsSummary.textContent = 'Đang tìm quán quanh điểm chung…';
    renderSkeletons();
  } else {
    updateSearchButton();
  }
}

function updateAddButton() {
  addPersonButton.hidden = state.people.length >= MAX_PEOPLE;
}

function syncEndpoints({ fit = false } = {}) {
  const located = state.people
    .filter((person) => person.coords)
    .map((person) => ({
      id: person.id,
      label: person.label,
      color: person.color,
      coords: person.coords,
    }));
  const allLocated =
    state.people.length >= 2 && state.people.every((person) => person.coords);
  const center = allLocated
    ? centroid(state.people.map((person) => person.coords))
    : null;

  state.midpoint = center;
  mapView.setEndpoints({
    people: located,
    midpoint: center,
    radiusM: center ? state.radiusKm * 1000 : null,
  });

  if (fit && allLocated) {
    mapView.fitSearch();
  } else if (fit && located.length > 0) {
    mapView.fitPoints(located);
  }
}

function refreshEndpointRadius() {
  const located = state.people
    .filter((person) => person.coords)
    .map((person) => ({
      id: person.id,
      label: person.label,
      color: person.color,
      coords: person.coords,
    }));

  if (state.midpoint && state.people.every((person) => person.coords)) {
    mapView.setEndpoints({
      people: located,
      midpoint: state.midpoint,
      radiusM: state.radiusKm * 1000,
    });
  } else {
    syncEndpoints();
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

function cancelLocationRequest(person) {
  person.locationSeq += 1;
  person.row?.querySelector('[data-locate]')?.classList.remove('is-loading');
}

function handleLocationEdit(person) {
  cancelLocationRequest(person);
  person.labelText = person.input.value;
  person.placeId = null;
  person.coords = null;
  clearStatus(person);
  syncEndpoints();
  clearResults();
  updateSearchButton();
}

async function loadDetail(person) {
  const id = person.placeId;
  if (!id) return;

  setFieldLoading(person);

  try {
    const data = await getJson('/api/places/detail', { placeId: id });
    if (person.placeId !== id) return;
    person.coords = { lat: data.place.lat, lng: data.place.lng };
    person.labelText = data.place.address || data.place.name || person.labelText;
    clearStatus(person);
    syncEndpoints({ fit: true });
    updateSearchButton();
  } catch {
    if (person.placeId !== id) return;
    setFieldError(person, 'Không tải được địa chỉ.', () => loadDetail(person));
  }
}

function handlePrediction(person, prediction) {
  cancelLocationRequest(person);
  person.labelText = prediction.description;
  person.placeId = prediction.placeId;
  person.coords = null;
  clearStatus(person);
  syncEndpoints();
  clearResults();
  updateSearchButton();
  loadDetail(person);
}

function nextLabel() {
  const used = new Set(state.people.map((person) => person.label));
  return ['A', 'B', 'C', 'D', 'E', 'F'].find((label) => !used.has(label)) || null;
}

function sortPeople() {
  state.people.sort((first, second) => first.label.localeCompare(second.label));
  for (const person of state.people) peopleList.append(person.row);
}

function createPerson(label) {
  const id = label.toLowerCase();
  const person = {
    id,
    label,
    color: PERSON_COLORS[label],
    placeId: null,
    coords: null,
    labelText: '',
    input: null,
    list: null,
    status: null,
    field: null,
    row: null,
    locationSeq: 0,
  };
  const removable = label !== 'A' && label !== 'B';

  const row = document.createElement('div');
  row.className = `location-field${removable ? ' has-remove' : ''}`;
  row.dataset.side = id;
  row.innerHTML = `
    <span class="pin" style="background:${person.color}" aria-hidden="true">${label}</span>
    <div class="location-main">
      <label for="location-${id}">Người ${label}</label>
      <div class="input-shell">
        <input
          id="location-${id}"
          class="location-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Nhập địa chỉ hoặc tên nơi..."
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls="suggestions-${id}"
          aria-expanded="false"
        />
        <div class="suggestions" id="suggestions-${id}" role="listbox" hidden></div>
      </div>
      <div class="field-status" id="status-${id}" aria-live="polite"></div>
    </div>
    <button
      type="button"
      class="icon-btn locate-btn"
      data-locate="${id}"
      aria-label="Dùng vị trí hiện tại cho người ${label}"
      title="Vị trí của tôi"
    >${LOCATE_ICON}</button>
    ${
      removable
        ? `<button type="button" class="remove-person" data-remove="${id}" aria-label="Xoá người ${label}" title="Xoá">${REMOVE_ICON}</button>`
        : ''
    }
  `;

  peopleList.append(row);
  person.row = row;
  person.input = row.querySelector('.location-input');
  person.list = row.querySelector('.suggestions');
  person.status = row.querySelector('.field-status');
  person.field = row;
  state.people.push(person);

  row.querySelector('[data-locate]')?.addEventListener('click', () => activateLocation(person));
  row.querySelector('[data-remove]')?.addEventListener('click', () => removePerson(person));

  createAutocomplete({
    input: person.input,
    list: person.list,
    onSelect: (prediction) => handlePrediction(person, prediction),
    onDirty: () => handleLocationEdit(person),
  });

  updateAddButton();
  return person;
}

function addPerson() {
  const label = nextLabel();
  if (!label) return;
  const person = createPerson(label);
  sortPeople();
  syncEndpoints();
  clearResults();
  updateSearchButton();
  person.input.focus();
  person.row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function removePerson(person) {
  if (state.people.length <= 2 || person.label === 'A' || person.label === 'B') return;
  cancelLocationRequest(person);
  person.row.remove();
  state.people = state.people.filter((candidate) => candidate !== person);
  sortPeople();
  syncEndpoints();
  clearResults();
  updateAddButton();
  updateSearchButton();
}

async function resolveInput(person, signal) {
  if (person.coords) return person;

  if (person.placeId) {
    setFieldLoading(person);
    try {
      const data = await getJson(
        '/api/places/detail',
        { placeId: person.placeId },
        signal,
      );
      person.coords = { lat: data.place.lat, lng: data.place.lng };
      person.labelText = data.place.address || data.place.name || person.labelText;
      clearStatus(person);
      syncEndpoints({ fit: true });
      return person;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      error.isLocationError = true;
      error.person = person;
      setFieldError(person, 'Không tải được địa chỉ.', () => resolveInput(person));
      throw error;
    }
  }

  const query = person.input.value.trim();
  if (!query) {
    setFieldHint(person, `Chọn địa chỉ cho người ${person.label}`);
    const missing = new Error('MISSING_LOCATION');
    missing.person = person;
    throw missing;
  }

  setFieldLoading(person, 'Đang xác định địa chỉ…');
  try {
    const data = await getJson(
      '/api/places/autocomplete',
      { input: query, limit: 5 },
      signal,
    );
    const first = data.predictions?.[0];
    if (!first) {
      const notFound = new Error('LOCATION_NOT_FOUND');
      notFound.isLocationError = true;
      notFound.person = person;
      setFieldError(person, 'Chưa tìm thấy địa chỉ.', () => resolveInput(person));
      throw notFound;
    }

    person.labelText = first.description;
    person.placeId = first.placeId;
    person.coords = null;
    person.input.value = first.description;

    const detail = await getJson(
      '/api/places/detail',
      { placeId: first.placeId },
      signal,
    );
    person.coords = { lat: detail.place.lat, lng: detail.place.lng };
    person.labelText = detail.place.address || first.description;
    clearStatus(person);
    syncEndpoints({ fit: true });
    return person;
  } catch (error) {
    if (error.name === 'AbortError' || error.message === 'LOCATION_NOT_FOUND') {
      throw error;
    }
    error.isLocationError = true;
    error.person = person;
    setFieldError(person, 'Không xác định được địa chỉ.', () => resolveInput(person));
    throw error;
  }
}

function activateLocation(person) {
  if (!navigator.geolocation) return;
  const button = person.row.querySelector('[data-locate]');
  if (!button) return;
  const requestId = ++person.locationSeq;
  button.classList.add('is-loading');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (person.locationSeq !== requestId) return;
      button.classList.remove('is-loading');
      person.placeId = null;
      person.coords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      person.labelText = 'Vị trí hiện tại';
      person.input.value = 'Vị trí hiện tại';
      clearStatus(person);
      syncEndpoints({ fit: true });
      clearResults();
      updateSearchButton();
    },
    () => {
      if (person.locationSeq === requestId) button.classList.remove('is-loading');
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  );
}

function renderIntro() {
  resultsSummary.textContent = '';
  const card = document.createElement('div');
  card.className = 'intro-card';
  const title = document.createElement('h3');
  title.textContent = 'Chọn điểm hẹn cho nhóm';
  const description = document.createElement('p');
  description.textContent =
    'Nhập vị trí của ít nhất hai người. Ứng dụng sẽ tìm quán ở khoảng giữa và cân thời gian đi lại cho cả nhóm.';
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

function prepareResultsLayout() {
  if (!window.matchMedia('(max-width: 860px)').matches) return;

  const mapWrap = document.querySelector('.map-wrap');
  const currentHeight = mapWrap.getBoundingClientRect().height;
  if (currentHeight < window.innerHeight * 0.3) {
    const target = Math.round(window.innerHeight * 0.4);
    appElement.style.setProperty('--map-height', `${target}px`);
    sheetHandle.setAttribute('aria-valuenow', String(target));
    mapView.resize();
  }
}

function scrollToResultsOnMobile() {
  if (!window.matchMedia('(max-width: 860px)').matches) return;
  prepareResultsLayout();
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
  card.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) return;
    selectResult(index);
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
  name.id = `result-name-${index}`;
  name.textContent = place.name;
  card.setAttribute('aria-labelledby', name.id);
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

  const travel = document.createElement('div');
  travel.className = 'travel-grid';
  state.people.forEach((person, personIndex) => {
    const item = document.createElement('div');
    item.className = 'travel-item';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = person.color;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'travel-name';
    nameSpan.textContent = person.label;
    const value = document.createElement('span');
    value.className = 'travel-value';
    if (place.hasTravel) {
      const leg = place.travels[personIndex];
      value.textContent = `${formatDistance(leg.distanceMeters)} · ${formatDuration(leg.durationSeconds)}`;
    } else {
      value.textContent = formatDistance(place.distances[personIndex]);
    }
    item.append(dot, nameSpan, value);
    travel.append(item);
  });
  card.append(travel);

  const midpointLine = document.createElement('p');
  midpointLine.className = 'midpoint-line';
  midpointLine.textContent = `Cách điểm ${state.people.length > 2 ? 'chung' : 'giữa'} ${formatDistance(place.distanceMid)}`;
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

  resultsSummary.textContent = `${state.results.length} gợi ý trong ${formatDistance(state.radiusKm * 1000)} · ${state.people.length} người`;
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
  if (!place) return;

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
    const routes = [];
    for (const person of state.people) {
      if (!person.coords) continue;
      let route = null;
      try {
        route = await getRoute(person.coords, place, controller.signal);
      } catch (error) {
        if (error.name === 'AbortError') throw error;
      }
      if (token !== routeSeq) return;
      if (route?.polyline) {
        routes.push({
          color: person.color,
          coordinates: decodePolyline(route.polyline),
        });
      }
    }
    mapView.drawRoutes(routes);
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
    for (const person of state.people) {
      await resolveInput(person, controller.signal);
      if (seq !== state.seq) return;
    }

    const peopleCoords = state.people.map((person) => person.coords);
    const radiusM = state.radiusKm * 1000;
    const keyword = keywordInput.value.trim() || 'quán ăn';
    let center = centroid(peopleCoords);

    const candidates = generateMeetingCandidates({
      people: peopleCoords,
      radiusM,
    });
    if (candidates.length > 1) {
      try {
        const meetingMatrix = await getJson(
          '/api/places/matrix',
          {
            origins: peopleCoords
              .map((coord) => `${coord.lat},${coord.lng}`)
              .join('|'),
            destinations: candidates
              .map((coord) => `${coord.lat},${coord.lng}`)
              .join('|'),
            vehicle: 'car',
          },
          controller.signal,
        );
        if (seq !== state.seq) return;
        const meeting = chooseMeetingPoint(candidates, meetingMatrix.rows);
        if (meeting) center = { lat: meeting.lat, lng: meeting.lng };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
      }
    }

    state.keyword = keyword;
    state.midpoint = center;
    mapView.setEndpoints({
      people: state.people.map((person) => ({
        id: person.id,
        label: person.label,
        color: person.color,
        coords: person.coords,
      })),
      midpoint: center,
      radiusM,
    });

    const discover = await getJson(
      '/api/discover',
      {
        q: keyword,
        ll: `@${center.lat.toFixed(6)},${center.lng.toFixed(6)},${zoomForRadius(state.radiusKm)}z`,
      },
      controller.signal,
    );
    if (seq !== state.seq) return;

    const prepared = preRank(discover.places || [], {
      midpoint: center,
      people: peopleCoords,
      radiusM,
      limit: 8,
    });

    if (prepared.length === 0) {
      state.results = [];
      state.searched = true;
      prepareResultsLayout();
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
          origins: peopleCoords
            .map((coord) => `${coord.lat},${coord.lng}`)
            .join('|'),
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
    prepareResultsLayout();
    renderResults();
    mapView.setResults(state.results);
    mapView.fitSearch();
    scrollToResultsOnMobile();
  } catch (error) {
    if (error.name === 'AbortError' || seq !== state.seq) return;
    if (
      error.message === 'MISSING_LOCATION' ||
      error.isLocationError ||
      error.message === 'LOCATION_NOT_FOUND'
    ) {
      restoreResults();
      const missing = error.person || state.people.find((person) => !person.coords);
      missing?.input.focus();
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

function setupMobileSheet() {
  const mobileQuery = window.matchMedia('(max-width: 860px)');
  const MIN_MAP = 72;
  const PANEL_BAR = 56;
  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  const mapHeight = () => document.querySelector('.map-wrap').getBoundingClientRect().height;
  const maxMapHeight = () => Math.max(MIN_MAP, window.innerHeight - PANEL_BAR);

  function updateHandleAria() {
    sheetHandle.setAttribute('aria-valuemin', String(MIN_MAP));
    sheetHandle.setAttribute('aria-valuemax', String(Math.round(maxMapHeight())));
    sheetHandle.setAttribute('aria-valuenow', String(Math.round(mapHeight())));
  }

  function setMapHeight(height) {
    const value = Math.min(maxMapHeight(), Math.max(MIN_MAP, height));
    appElement.style.setProperty('--map-height', `${value}px`);
    sheetHandle.setAttribute('aria-valuenow', String(Math.round(value)));
  }

  function snapHeight() {
    const current = mapHeight();
    const points = [MIN_MAP, window.innerHeight * 0.4, maxMapHeight()];
    const nearest = points.reduce((best, point) =>
      Math.abs(point - current) < Math.abs(best - current) ? point : best,
    );
    setMapHeight(nearest);
  }

  sheetHandle.addEventListener('pointerdown', (event) => {
    if (!mobileQuery.matches) return;
    dragging = true;
    startY = event.clientY;
    startHeight = mapHeight();
    sheetHandle.classList.add('is-dragging');
    document.body.classList.add('is-resizing');
    try {
      sheetHandle.setPointerCapture(event.pointerId);
    } catch {}
    event.preventDefault();
  });

  sheetHandle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    setMapHeight(startHeight + event.clientY - startY);
  });

  // Resize WebGL once on release; doing it on every move makes the map flicker.
  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    sheetHandle.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing');
    try {
      sheetHandle.releasePointerCapture(event.pointerId);
    } catch {}
    snapHeight();
    mapView.resize();
  };

  sheetHandle.addEventListener('pointerup', endDrag);
  sheetHandle.addEventListener('pointercancel', endDrag);

  sheetHandle.addEventListener('keydown', (event) => {
    if (!mobileQuery.matches) return;
    let changed = true;
    if (event.key === 'ArrowUp') {
      setMapHeight(mapHeight() - 40);
    } else if (event.key === 'ArrowDown') {
      setMapHeight(mapHeight() + 40);
    } else if (event.key === 'Home') {
      setMapHeight(MIN_MAP);
    } else if (event.key === 'End') {
      setMapHeight(maxMapHeight());
    } else if (event.key === 'Enter' || event.key === ' ') {
      setMapHeight(
        mapHeight() > window.innerHeight * 0.6 ? window.innerHeight * 0.4 : maxMapHeight(),
      );
    } else {
      changed = false;
    }
    if (changed) {
      event.preventDefault();
      mapView.resize();
    }
  });

  document.addEventListener('focusin', (event) => {
    if (!mobileQuery.matches) return;
    if (!event.target.matches('.location-input, #keyword')) return;
    if (mapHeight() > MIN_MAP + 2) {
      setMapHeight(MIN_MAP);
      mapView.resize();
      setTimeout(() => {
        event.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 140);
    }
  });

  window.addEventListener('resize', () => {
    if (!mobileQuery.matches) {
      appElement.style.removeProperty('--map-height');
      updateHandleAria();
      return;
    }
    if (appElement.style.getPropertyValue('--map-height')) {
      setMapHeight(mapHeight());
    } else {
      updateHandleAria();
    }
    mapView.resize();
  });

  updateHandleAria();
}

function initialize() {
  renderIntro();
  createPerson('A');
  createPerson('B');
  updateAddButton();
  updateChips();
  setupMobileSheet();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });

  addPersonButton.addEventListener('click', addPerson);

  for (const chip of chipList.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      keywordInput.value = chip.dataset.keyword;
      updateChips();
      if (state.results.length > 0 || state.loading) clearResults();
      updateSearchButton();
    });
  }

  keywordInput.addEventListener('input', () => {
    updateChips();
    if (state.results.length > 0 || state.loading) clearResults();
    updateSearchButton();
  });

  radiusInput.addEventListener('input', () => {
    state.radiusKm = Number(radiusInput.value);
    radiusValue.textContent = `${state.radiusKm} km`;
    if (state.results.length > 0 || state.loading) clearResults();
    refreshEndpointRadius();
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
