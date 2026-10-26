import { getJson } from './api.js';

let counter = 0;

export function createAutocomplete({ input, list, onSelect, onDirty }) {
  const idBase = `suggestion-${(counter += 1)}`;
  let timer = null;
  let controller = null;
  let items = [];
  let activeIndex = -1;
  let pointerRecentlyInside = false;
  let pointerTimer = null;

  function close() {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    items = [];
    activeIndex = -1;
    pointerRecentlyInside = false;
    clearTimeout(pointerTimer);
  }

  function showLoading() {
    list.replaceChildren();
    const row = document.createElement('div');
    row.className = 'suggestion-loading';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    row.append(spinner, document.createTextNode('Đang tìm…'));
    list.append(row);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function setActive(index) {
    activeIndex = index;
    const buttons = [...list.querySelectorAll('.suggestion')];
    buttons.forEach((button, buttonIndex) => {
      button.classList.toggle('is-active', buttonIndex === index);
    });
    const active = buttons[index];
    if (active) {
      input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function choose(index) {
    const prediction = items[index];
    if (!prediction) return;
    input.value = prediction.description;
    close();
    onSelect(prediction);
  }

  function render(predictions) {
    list.replaceChildren();
    items = predictions;
    activeIndex = -1;

    if (predictions.length === 0) {
      close();
      return;
    }

    predictions.forEach((prediction, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion';
      button.id = `${idBase}-${index}`;
      button.setAttribute('role', 'option');
      button.dataset.index = String(index);

      const main = document.createElement('span');
      main.className = 'suggestion-main';
      main.textContent = prediction.mainText || prediction.description;

      const secondary = document.createElement('span');
      secondary.className = 'suggestion-sub';
      secondary.textContent = prediction.secondaryText || '';

      button.append(main);
      if (secondary.textContent) button.append(secondary);
      list.append(button);
    });

    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  async function load(query) {
    controller?.abort();
    controller = new AbortController();
    showLoading();

    try {
      const data = await getJson(
        '/api/places/autocomplete',
        { input: query, limit: 5 },
        controller.signal,
      );
      if (input.value.trim() !== query) return;
      render(data.predictions || []);
    } catch (error) {
      if (error.name === 'AbortError') return;
      close();
    }
  }

  input.addEventListener('input', () => {
    onDirty?.();
    controller?.abort();
    if (timer) clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) {
      close();
      return;
    }
    timer = setTimeout(() => load(query), 400);
  });

  input.addEventListener('keydown', (event) => {
    if (list.hidden) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter') {
      if (items.length > 0) {
        event.preventDefault();
        choose(activeIndex >= 0 ? activeIndex : 0);
      }
    } else if (event.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!pointerRecentlyInside) close();
    }, 120);
  });

  list.addEventListener('pointerdown', (event) => {
    pointerRecentlyInside = true;
    clearTimeout(pointerTimer);
    pointerTimer = setTimeout(() => {
      pointerRecentlyInside = false;
      if (document.activeElement !== input) close();
    }, 500);
    if (event.pointerType === 'mouse') event.preventDefault();
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('.suggestion');
    if (!button) return;
    choose(Number(button.dataset.index));
  });

  return {
    close,
    setValue(value) {
      input.value = value;
      close();
    },
  };
}
