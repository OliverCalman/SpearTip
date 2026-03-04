// ── BOTTOM DRAWER ─────────────────────────────────────────────────────────────
// Shows detailed marine conditions for a clicked or selected location.
import { CONFIG } from './config.js';
import { fetchConditionsAt }                   from './weather.js';
import { buildMarineSection, buildWeatherSection } from './weather.js';
import { renderTideSection }                   from './tides.js';
import { buildWaterQualitySection, getRainfall24h } from './waterQuality.js';
import { getSpeciesLikelihood }                from './species.js';
import { addFavourite, removeFavourite, isFavourite } from './favourites.js';

let _map      = null;
let _clickPin = null;
let _curLat   = null;
let _curLng   = null;
let _curName  = null;

// Permanent depth cache: '±lat2_±lng2' → metres (positive) | null
const _depthCache = {};

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initDrawer(map) {
  _map = map;

  // Map click
  map.on('click', e => handleMapClick(e.latlng.lat, e.latlng.lng));

  // Close button
  document.getElementById('d-close').addEventListener('click', close);

  // Fav button
  document.getElementById('fav-btn').addEventListener('click', toggleFavourite);

  // Escape key
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

export function openAt(lat, lng, name) {
  _curLat  = lat;
  _curLng  = lng;
  _curName = name;

  // Drop a click pin
  if (_clickPin) _map.removeLayer(_clickPin);
  _clickPin = L.marker([lat, lng], {
    icon: L.divIcon({ className: '', html: '<div class="cpin"></div>', iconAnchor: [6, 6] }),
  }).addTo(_map);

  document.getElementById('hint').classList.add('hidden');
  document.getElementById('d-loc').textContent    = name || 'Fetching name…';
  document.getElementById('d-coords').textContent = formatCoords(lat, lng);
  document.getElementById('d-body').innerHTML     = skeleton();
  updateFavButton(lat, lng);
  open();
  loadData(lat, lng, name);
}

export function close() {
  document.getElementById('drawer').classList.remove('open');
  if (_clickPin) { _map.removeLayer(_clickPin); _clickPin = null; }
}

// ── INTERNAL ─────────────────────────────────────────────────────────────────

function handleMapClick(lat, lng) {
  openAt(lat, lng, null);
}

async function loadData(lat, lng, nameHint) {
  try {
    // Parallel fetch: conditions + place name + bathymetric depth
    const [{ marine, weather }, placeName, depth] = await Promise.all([
      fetchConditionsAt(lat, lng),
      nameHint || revGeo(lat, lng),
      fetchDepth(lat, lng),
    ]);

    const name = nameHint || placeName || formatShortCoords(lat, lng);
    _curName   = name;
    document.getElementById('d-loc').textContent = name;

    // Merge marine + weather current: marine wins where non-null, weather fills
    // wind/gusts which the marine model often omits for near-shore locations.
    const mc = marine?.current  || {};
    const wc = weather?.current || {};
    const mergedMarine = {
      ...mc,
      wind_speed_10m:     mc.wind_speed_10m     ?? wc.wind_speed_10m,
      wind_direction_10m: mc.wind_direction_10m  ?? wc.wind_direction_10m,
      wind_gusts_10m:     mc.wind_gusts_10m      ?? wc.wind_gusts_10m,
    };
    renderDrawer(lat, lng, mergedMarine, weather, depth);
    updateFavButton(lat, lng);

  } catch (err) {
    // Open-Meteo Marine returns this reason for inland points — close silently
    if (err.message?.includes('No data is available')) {
      close();
      return;
    }
    document.getElementById('d-body').innerHTML = `
      <p style="color:var(--coral);font-size:12px;padding:8px 0">
        Unable to fetch data for this location.<br>
        <small style="color:var(--muted)">${err.message}</small>
      </p>`;
  }
}

function renderDrawer(lat, lng, marine, weather, depth) {
  const species = getSpeciesLikelihood(lat, lng);

  // Detect nearest pre-prepared location for water quality
  const nearLoc = CONFIG.locations.find(l =>
    Math.hypot(l.lat - lat, l.lng - lng) < 0.05
  );

  let html = '';

  // 1. Weather (first — quick surface conditions overview)
  html += buildWeatherSection(weather);

  // 3. Marine conditions (waves, swell, wetsuit rec)
  html += buildMarineSection(marine);

  // 3b. Water depth (GEBCO bathymetry)
  html += buildDepthSection(depth);

  // 4. Tide chart placeholder (populated after HTML is set in DOM)
  html += '<div id="__tide_section__"></div>';

  // 5. Water quality
  const rainfall24h = nearLoc ? getRainfall24h(nearLoc.id) : 0;
  if (nearLoc) {
    html += buildWaterQualitySection(nearLoc.id);
  }

  // 6. Shark activity
  html += buildSharkSection(marine, lat, rainfall24h);

  // 7. Species likelihood
  html += buildSpeciesSection(species);

  // 7. Data source note
  html += `<div style="font-size:10px;color:var(--muted);line-height:1.7;margin-top:8px">
    Marine data: <a href="https://open-meteo.com" target="_blank" style="color:var(--cyan)">Open-Meteo Marine API</a> ·
    Tides: BOM harmonic model ·
    Species: <a href="https://www.ala.org.au" target="_blank" style="color:var(--lime)">ALA</a>
  </div>`;

  document.getElementById('d-body').innerHTML = html;

  // Inject tide section (requires canvas to be in DOM)
  const tidePlaceholder = document.getElementById('__tide_section__');
  if (tidePlaceholder) renderTideSection(tidePlaceholder);
}

// ── SPECIES SECTION ───────────────────────────────────────────────────────────

function buildSpeciesSection(speciesData) {
  const rows = speciesData.map(({ species: sp, nearby }) => {
    const color      = sp.color;
    const countLabel = nearby === 0
      ? 'No records within 5 km'
      : `${nearby} record${nearby === 1 ? '' : 's'} within 5 km`;

    return `<div class="species-row">
      <div class="sp-name">
        <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div>
        <div>
          <div style="font-size:12px;color:var(--text)">${sp.name}</div>
          <div style="font-size:10px;color:var(--muted);font-style:italic">${sp.scientific}</div>
        </div>
      </div>
      <span class="sp-likelihood" style="color:${color};font-size:10px;margin-left:auto;white-space:nowrap">${countLabel}</span>
    </div>`;
  }).join('');

  return `<div class="d-section">
    <div class="d-section-title">Species Occurrence Density
      <span class="api-badge b-ala" style="margin-left:4px">ALA LIVE</span>
    </div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px">
      ALA verified records within 5 km of this point
    </div>
    ${rows}
  </div>`;
}

// ── SHARK ACTIVITY ────────────────────────────────────────────────────────────
// Composite risk estimate for bull, white, and tiger sharks based on SST,
// season (month), and water turbidity from recent rainfall.
// Sources: NSW DPI shark data, published literature on shark habitat preferences.

function buildSharkSection(marine, lat, rainfall24h) {
  const sst   = marine.sea_surface_temperature;
  const month = new Date().getMonth() + 1;  // 1–12
  const sstLabel = sst != null ? `${sst.toFixed(1)} °C SST` : 'SST unknown';

  const sharks = [
    assessBullShark(sst, month, rainfall24h, lat),
    assessWhiteShark(sst, month),
    assessTigerShark(sst, month, lat),
  ];

  const rows = sharks.map(s => `
    <div class="species-row">
      <div class="sp-name">
        <div style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0;margin-top:2px"></div>
        <div>
          <div style="font-size:12px;color:var(--text)">${s.name}</div>
          <div style="font-size:10px;color:var(--muted)">${s.note}</div>
        </div>
      </div>
      <span style="color:${s.color};font-size:10px;margin-left:auto;white-space:nowrap;font-weight:600;padding-left:8px">${s.risk}</span>
    </div>`).join('');

  return `<div class="d-section">
    <div class="d-section-title">Shark Activity
      <span class="api-badge" style="background:rgba(255,95,109,.12);color:#ff5f6d;border:1px solid rgba(255,95,109,.25);margin-left:4px">NSW</span>
    </div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px">
      Estimated from ${sstLabel}, season and water clarity
    </div>
    ${rows}
    <div style="font-size:9px;color:var(--muted);margin-top:10px;line-height:1.6;border-top:1px solid rgba(58,90,120,.25);padding-top:7px">
      Always dive with a buddy and check the
      <a href="https://www.dpi.nsw.gov.au/fishing/sharksmart" target="_blank" style="color:var(--cyan)">NSW DPI SharkSmart</a>
      log before entering the water.
    </div>
  </div>`;
}

function assessBullShark(sst, month, rainfall24h, lat) {
  // Active year-round in warm estuarine and coastal waters; peak Oct–Apr
  let score = 0;
  if (sst != null) {
    if (sst > 20) score += 2;
    else if (sst > 17) score += 1;
  }
  if ([10, 11, 12, 1, 2, 3, 4].includes(month)) score += 1;
  if (rainfall24h > 20) score += 1;  // murky runoff — disoriented prey
  if (lat > -34.0) score += 1;       // more prevalent in northern Sydney harbours

  const note = sst != null && sst > 20
    ? 'Warm water. Aactive near estuaries, river mouths & surf zones'
    : 'Cooler conditions. Activity reduced but possible near outflows';
  return sharkEntry('Bull Shark', score, note);
}

function assessWhiteShark(sst, month) {
  // Prefer 12–20 °C; year-round in NSW; peak Apr–Oct when seals aggregate
  let score = 0;
  if (sst != null) {
    if (sst >= 12 && sst <= 20) score += 2;
    else if (sst < 23) score += 1;
  } else {
    score += 1; // unknown SST — present year-round in NSW
  }
  if ([4, 5, 6, 7, 8, 9, 10].includes(month)) score += 1;

  const note = (sst != null && sst >= 12 && sst <= 20)
    ? 'Preferred temperature range. Offshore presence likely'
    : 'Sub-optimal temp. Present but less active near surface';
  return sharkEntry('White Shark', score, note);
}

function assessTigerShark(sst, month, lat) {
  // Tropical/subtropical; uncommon south of Sydney; warm summer months
  let score = 0;
  if (sst != null) {
    if (sst > 22) score += 2;
    else if (sst > 19) score += 1;
  }
  if ([12, 1, 2].includes(month)) score += 1;
  if (lat > -33.5) score += 1;  // northern coastal NSW

  const note = (sst != null && sst > 22)
    ? 'Warm conditions. Possible, more common in northern NSW'
    : 'Cool for tiger sharks. Uncommon in Sydney waters';
  return sharkEntry('Tiger Shark', score, note);
}

function sharkEntry(name, score, note) {
  let risk, color;
  if      (score >= 4) { risk = 'HIGH';     color = '#ff5f6d'; }
  else if (score >= 2) { risk = 'MODERATE'; color = '#ffb347'; }
  else                 { risk = 'LOW';      color = '#aaff5e'; }
  return { name, risk, color, note };
}

// ── FAVOURITES ────────────────────────────────────────────────────────────────

function toggleFavourite() {
  if (!_curLat || !_curLng) return;

  const btn = document.getElementById('fav-btn');
  if (isFavourite(_curLat, _curLng)) {
    // Find and remove
    const favs = window.__getFavs ? window.__getFavs() : [];
    const match = favs.find(f => Math.abs(f.lat - _curLat) < 0.001 && Math.abs(f.lng - _curLng) < 0.001);
    if (match) removeFavourite(match.id);
    btn.textContent = '☆';
    btn.classList.remove('active');
  } else {
    addFavourite(_curLat, _curLng, _curName || formatShortCoords(_curLat, _curLng));
    btn.textContent = '★';
    btn.classList.add('active');
  }
}

function updateFavButton(lat, lng) {
  const btn    = document.getElementById('fav-btn');
  const isF    = isFavourite(lat, lng);
  btn.textContent = isF ? '★' : '☆';
  btn.classList.toggle('active', isF);
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────

async function revGeo(lat, lng) {
  try {
    const resp = await fetch(
      `${CONFIG.api.nominatim}/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const d = await resp.json();
    // Nominatim returns {"error":"Unable to geocode"} for open ocean
    if (d.error) return 'Ocean';
    if (d.address) {
      // Prefer specific coastal/local name
      const name = d.address.beach   || d.address.bay      || d.address.harbour ||
                   d.address.suburb  || d.address.town      || d.address.city    ||
                   d.address.sea     || d.address.ocean;
      if (name) return name;
      // Fall back to first token of display_name if present
      const first = d.display_name?.split(',')[0]?.trim();
      if (first) return first;
    }
  } catch { /* ignore */ }
  return 'Ocean';
}

function formatCoords(lat, lng) {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
}

function formatShortCoords(lat, lng) {
  return `${Math.abs(lat).toFixed(3)}°S, ${lng.toFixed(3)}°E`;
}

// ── DEPTH ─────────────────────────────────────────────────────────────────────

// Fetch GEBCO bathymetric depth for a clicked ocean point.
// Tries exact point first, then two nearby offshore offsets in one request.
// Returns depth in metres (positive) or null.
async function fetchDepth(lat, lng) {
  const key = `${lat.toFixed(2)}_${lng.toFixed(2)}`;
  if (key in _depthCache) return _depthCache[key];

  try {
    const pts = [
      [lat,           lng         ],
      [lat,           lng + 0.012 ],
      [lat,           lng - 0.012 ],
      [lat + 0.008,   lng         ],
      [lat - 0.008,   lng         ],
    ];
    const locs = pts.map(([la, ln]) => `${la.toFixed(4)},${ln.toFixed(4)}`).join('|');
    const resp = await fetch(`https://api.opentopodata.org/v1/gebco2020?locations=${locs}`);
    if (!resp.ok) { _depthCache[key] = null; return null; }
    const data = await resp.json();
    for (const r of data.results || []) {
      if (r.elevation != null && r.elevation < 0) {
        const d = Math.round(-r.elevation);
        _depthCache[key] = d;
        return d;
      }
    }
  } catch { /* no data */ }
  _depthCache[key] = null;
  return null;
}

function buildDepthSection(depth) {
  if (depth == null) return '';

  const label = depth < 5   ? 'Very shallow'
              : depth < 20  ? 'Shallow'
              : depth < 50  ? 'Moderate'
              : depth < 200 ? 'Deep'
              : 'Very deep';
  const color = depth < 5   ? 'var(--amber)'
              : depth < 20  ? 'var(--cyan)'
              : depth < 200 ? '#4fc3f7'
              : '#1a78c2';

  return `<div class="d-section">
    <div class="d-section-title">Water Depth
      <span class="api-badge" style="background:rgba(79,195,247,.1);color:#4fc3f7;border:1px solid rgba(79,195,247,.25);margin-left:4px">GEBCO</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding:10px 12px;background:rgba(255,255,255,.02);border:1px solid rgba(79,195,247,.15);
      border-radius:9px">
      <div style="display:flex;align-items:baseline;gap:4px">
        <span style="font-family:'Noto Sans',monospace;font-size:22px;color:${color};font-weight:600">~${depth}</span>
        <span style="font-size:11px;color:var(--muted)">m</span>
      </div>
      <span style="font-size:11px;color:${color}">${label}</span>
    </div>
  </div>`;
}

function skeleton() {
  return `<div class="skeleton" style="height:88px;margin-bottom:8px;border-radius:10px"></div>
          <div class="skeleton" style="height:56px;border-radius:10px"></div>`;
}

function open() {
  document.getElementById('drawer').classList.add('open');
}
