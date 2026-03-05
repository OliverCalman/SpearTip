// ── PANEL, CARDS & SEARCH UI ──────────────────────────────────────────────────
import { CONFIG, waveColor }                 from './config.js';
import { setHabitatVisible }                 from './habitat.js';
import { setSpeciesVisible }                 from './species.js';
import { setClosuresVisible, setNoTakeVisible } from './closures.js';
import { setWindVisible }                   from './wind.js';
import { openAt }                            from './drawer.js';
import { getFavourites }                     from './favourites.js';
import { getLocationData }                   from './weather.js';

let _map = null;

// Layer state
const layerState = {
  habitat:  true,
  species:  true,
  closures: true,
  notake:   true,
  wind:     true,
};

const layerHandlers = {
  habitat:  v => setHabitatVisible(v),
  species:  v => setSpeciesVisible(v),
  closures: v => setClosuresVisible(v),
  notake:   v => setNoTakeVisible(v),
  wind:     v => setWindVisible(v),
};

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initUI(map) {
  _map = map;

  buildCards();
  initLayerToggles();
  initSearch();

  // Expose getFavs for favourites.js drawer integration
  window.__getFavs = getFavourites;
}

// ── LOCATION CARDS ────────────────────────────────────────────────────────────

export function buildCards() {
  const bar = document.getElementById('cards-bar');
  bar.innerHTML = '';

  CONFIG.locations.forEach(loc => {
    const data   = getLocationData(loc.id);
    const marine = data?.marine?.current || {};
    const wh     = marine.wave_height;
    const wc     = wh != null ? waveColor(wh) : 'var(--muted)';
    const sst    = marine.sea_surface_temperature;
    const ws     = marine.wind_speed_10m;
    const wg     = marine.wind_gusts_10m;

    const card = document.createElement('div');
    card.className     = 'loc-card';
    card.dataset.locId = loc.id;
    card.innerHTML = `
      <div class="lc-name">${loc.name}</div>
      <div class="lc-metrics">
        <div class="lc-m">
          <span class="lc-v" style="color:${wc}">${wh != null ? wh.toFixed(1)+'m' : '-'}</span>
          <span class="lc-l">Wave</span>
        </div>
        <div class="lc-m">
          <span class="lc-v" style="color:var(--coral)">${sst != null ? sst.toFixed(1)+'°' : '-'}</span>
          <span class="lc-l">SST</span>
        </div>
        <div class="lc-m">
          <span class="lc-v" style="color:var(--text)">${ws != null ? ws.toFixed(0)+'kn' : '-'}</span>
          <span class="lc-l">Wind</span>
        </div>
        <div class="lc-m">
          <span class="lc-v" style="color:var(--amber)">${wg != null ? wg.toFixed(0)+'kn' : '-'}</span>
          <span class="lc-l">Gusts</span>
        </div>
      </div>`;

    card.addEventListener('click', () => {
      document.querySelectorAll('.loc-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      _map.flyTo([loc.lat, loc.lng], 15, { duration: 1.2 });
      openAt(loc.lat, loc.lng, loc.name);
    });

    bar.appendChild(card);
  });

  // Refresh cards every 10 min once data loads
  setTimeout(() => buildCards(), 600_000);
}

// ── LAYER TOGGLES ─────────────────────────────────────────────────────────────

function initLayerToggles() {
  document.querySelectorAll('.layer-row').forEach(row => {
    row.addEventListener('click', () => {
      const name = row.dataset.layer;
      if (!name || !(name in layerState)) return;

      layerState[name] = !layerState[name];
      const sw = document.getElementById(`sw-${name}`);
      if (sw) {
        sw.className = 'sw ' + (layerState[name] ? 'on' : 'off');
      }
      layerHandlers[name]?.(layerState[name]);
    });
  });
}

// ── GEOCODER SEARCH ───────────────────────────────────────────────────────────

let _searchTimer = null;

function initSearch() {
  const input   = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  if (!input) return;

  input.addEventListener('focus', () => {
    if (!input.value.trim()) showPresets(results);
  });

  input.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const q = input.value.trim();
    if (!q) { showPresets(results); return; }
    _searchTimer = setTimeout(() => doSearch(q, results), 350);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => results.classList.remove('visible'), 200);
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.classList.remove('visible');
    }
  });
}

function showPresets(resultsEl) {
  resultsEl.innerHTML = CONFIG.locations.map(loc => `
    <div class="search-item" data-lat="${loc.lat}" data-lng="${loc.lng}" data-name="${loc.name}">
      ${loc.name}
      <div class="si-sub">Pre-prepared location</div>
    </div>`).join('');
  resultsEl.classList.add('visible');
  attachSearchResultHandlers(resultsEl);
}

async function doSearch(query, resultsEl) {
  const presets = CONFIG.locations.filter(l =>
    l.name.toLowerCase().includes(query.toLowerCase())
  );

  try {
    const resp = await fetch(
      `${CONFIG.api.nominatim}/search?q=${encodeURIComponent(query)}+NSW+Australia` +
      `&format=json&limit=5&bounded=1&viewbox=149.0,-37.5,154.0,-28.0`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const places = await resp.json();

    const allResults = [
      ...presets.map(l => ({
        display_name: l.name,
        sub:          'Pre-prepared location',
        lat:          l.lat.toString(),
        lon:          l.lng.toString(),
        name:         l.name,
      })),
      ...places.map(p => ({
        display_name: p.display_name,
        sub:          p.type,
        lat:          p.lat,
        lon:          p.lon,
        name:         p.display_name.split(',')[0],
      })),
    ].slice(0, 6);

    if (allResults.length === 0) {
      resultsEl.innerHTML = `<div class="search-item" style="color:var(--muted)">No results found</div>`;
    } else {
      resultsEl.innerHTML = allResults.map(r => `
        <div class="search-item" data-lat="${r.lat}" data-lng="${r.lon}" data-name="${r.name}">
          ${escHtml(r.name)}
          <div class="si-sub">${escHtml(r.sub || r.display_name.split(',').slice(1,3).join(',') || '')}</div>
        </div>`).join('');
      attachSearchResultHandlers(resultsEl);
    }
  } catch {
    if (presets.length > 0) showPresets(resultsEl);
    else resultsEl.innerHTML = `<div class="search-item" style="color:var(--muted)">Search unavailable</div>`;
  }

  resultsEl.classList.add('visible');
}

function attachSearchResultHandlers(resultsEl) {
  resultsEl.querySelectorAll('.search-item[data-lat]').forEach(item => {
    item.addEventListener('click', () => {
      const lat  = parseFloat(item.dataset.lat);
      const lng  = parseFloat(item.dataset.lng);
      const name = item.dataset.name;
      resultsEl.classList.remove('visible');
      document.getElementById('search-input').value = name;
      _map.flyTo([lat, lng], 13, { duration: 1.2 });
      openAt(lat, lng, name);
    });
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
