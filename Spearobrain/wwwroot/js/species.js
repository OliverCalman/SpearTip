// ── SPECIES DISTRIBUTION LAYER ────────────────────────────────────────────────
// Live occurrence data from Atlas of Living Australia (ALA) biocache API.
// Visualised as per-species heatmaps using Leaflet.heat.
// Density score derived solely from ALA occurrence record count within 20 km.
import { CONFIG } from './config.js';

let _map           = null;
let _heatLayers    = {};   // keyed by species id
let _occurrences   = {};   // raw ALA occurrence cache
let _activeSpecies = new Set(); // multi-select — all active by default
let _visible       = true;

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initSpeciesLayer(map) {
  _map = map;
  fetchAllSpecies();
  setInterval(fetchAllSpecies, 86_400_000);

  // All species active by default
  _activeSpecies = new Set(CONFIG.species.map(sp => sp.id));
  updateAllBtnStates();
  updateFilterCount();

  // Dropdown open/close
  document.getElementById('species-filter-toggle')?.addEventListener('click', () => {
    document.getElementById('species-dropdown')?.classList.toggle('open');
    document.getElementById('species-filter-arrow')?.classList.toggle('open');
  });

  // All / None quick-select (stop propagation so dropdown stays open)
  document.getElementById('sp-all-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    CONFIG.species.forEach(sp => _activeSpecies.add(sp.id));
    updateAllBtnStates();
    updateFilterCount();
    updateHeatLayers();
  });
  document.getElementById('sp-none-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    _activeSpecies.clear();
    updateAllBtnStates();
    updateFilterCount();
    updateHeatLayers();
  });

  // Per-species toggle buttons
  document.querySelectorAll('.species-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sp = btn.dataset.species;
      if (_activeSpecies.has(sp)) {
        _activeSpecies.delete(sp);
      } else {
        _activeSpecies.add(sp);
      }
      applyBtnState(btn);
      updateFilterCount();
      updateHeatLayers();
    });
  });
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function applyBtnState(btn) {
  const isActive = _activeSpecies.has(btn.dataset.species);
  btn.classList.toggle('active', isActive);
  if (isActive) {
    const c = btn.dataset.color;
    btn.style.borderColor = c;
    btn.style.color       = c;
    btn.style.background  = `${c}1a`;
  } else {
    btn.style.borderColor = '';
    btn.style.color       = '';
    btn.style.background  = '';
  }
}

function updateAllBtnStates() {
  document.querySelectorAll('.species-btn').forEach(btn => applyBtnState(btn));
}

function updateFilterCount() {
  const el = document.getElementById('species-filter-count');
  if (!el) return;
  const n     = _activeSpecies.size;
  const total = CONFIG.species.length;
  el.textContent = n === 0 ? 'None' : n === total ? `All ${total}` : `${n} / ${total}`;
}

export function setSpeciesVisible(on) {
  _visible = on;
  updateHeatLayers();
}

/**
 * Returns occurrence density for a given lat/lng point (used in drawer).
 * Score is purely the count of ALA records within 20 km, normalised to 0–1.
 * Returns array of { species, density (0-1), nearby (raw count) }
 */
export function getSpeciesLikelihood(lat, lng) {
  return CONFIG.species.map(sp => {
    const occs   = _occurrences[sp.id] || [];
    const nearby = occs.filter(o => haversineKm(lat, lng, o.lat, o.lng) < 5).length;
    return {
      species: sp,
      density: Math.min(nearby / 10, 1), // 10+ records within 5km = saturated
      nearby,
    };
  });
}

// ── FETCH ─────────────────────────────────────────────────────────────────────

async function fetchAllSpecies() {
  await Promise.allSettled(CONFIG.species.map(sp => fetchSpecies(sp)));
}

async function fetchSpecies(sp) {
  try {
    // Try ALA first (better Australian data)
    const alaUrl = `${CONFIG.api.ala}?q=${encodeURIComponent(sp.alaName)}` +
                   `&fq=country:Australia` +
                   `&lat=-33.9&lon=151.2&radius=200` + // 200km radius around Sydney
                   `&pageSize=500&fl=decimalLatitude,decimalLongitude,month,year`;
    const resp   = await fetch(alaUrl);
    if (resp.ok) {
      const json  = await resp.json();
      const occs  = (json.occurrences || [])
        .filter(o => o.decimalLatitude && o.decimalLongitude)
        .map(o => ({
          lat:   parseFloat(o.decimalLatitude),
          lng:   parseFloat(o.decimalLongitude),
          month: o.month ? parseInt(o.month) : null,
          year:  o.year  ? parseInt(o.year)  : null,
        }));
      _occurrences[sp.id] = occs;
      buildHeatLayer(sp, occs);
      return;
    }
  } catch { /* fall through to GBIF */ }

  try {
    // GBIF fallback
    const url  = `${CONFIG.api.gbif}?scientificName=${encodeURIComponent(sp.scientific)}` +
                 `&country=AU&decimalLatitude=-36,-28&decimalLongitude=148,154` +
                 `&hasCoordinate=true&limit=300`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const json = await resp.json();
    const occs = (json.results || [])
      .filter(o => o.decimalLatitude && o.decimalLongitude)
      .map(o => ({
        lat:   o.decimalLatitude,
        lng:   o.decimalLongitude,
        month: o.month || null,
        year:  o.year  || null,
      }));
    _occurrences[sp.id] = occs;
    buildHeatLayer(sp, occs);
  } catch { /* no data */ }
}

// ── HEAT LAYER MANAGEMENT ─────────────────────────────────────────────────────

function buildHeatLayer(sp, occs) {
  // Remove old layer if present
  if (_heatLayers[sp.id]) {
    _map.removeLayer(_heatLayers[sp.id]);
  }

  if (occs.length === 0) return;

  // Weight recent records higher
  const now   = new Date().getFullYear();
  const points = occs.map(o => {
    const age    = o.year ? now - o.year : 10;
    const weight = Math.max(0.2, 1 - age * 0.04); // 0.2 min for old records
    return [o.lat, o.lng, weight];
  });

  // Leaflet.heat options tuned per species movement patterns
  const heatOptions = {
    radius:  sp.id === 'flathead' ? 8 : 14,  // flathead more localised
    blur:    18,
    maxZoom: 14,
    gradient: buildGradient(sp.color),
  };

  _heatLayers[sp.id] = L.heatLayer(points, heatOptions);

  if (_visible && _activeSpecies.has(sp.id)) {
    _heatLayers[sp.id].addTo(_map);
  }
}

function updateHeatLayers() {
  CONFIG.species.forEach(sp => {
    const layer = _heatLayers[sp.id];
    if (!layer) return;

    if (_visible && _activeSpecies.has(sp.id)) {
      if (!_map.hasLayer(layer)) layer.addTo(_map);
    } else {
      if (_map.hasLayer(layer)) _map.removeLayer(layer);
    }
  });
}

// Build a Leaflet.heat gradient that goes from transparent → species colour
function buildGradient(hexColor) {
  // Convert hex to rgba components
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  return {
    0.0: `rgba(${r},${g},${b},0)`,
    0.3: `rgba(${r},${g},${b},0.2)`,
    0.6: `rgba(${r},${g},${b},0.55)`,
    1.0: `rgba(${r},${g},${b},0.85)`,
  };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2
             + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
