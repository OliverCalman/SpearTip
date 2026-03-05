// ── WEATHER + SEA SURFACE TEMPERATURE LAYER ──────────────────────────────────
// Source: Open-Meteo Marine API (no key, CORS-enabled)
// Fetches and caches data for pre-prepared locations - surfaced in cards/drawer.
// Map markers removed; data consumed by ui.js cards and drawer.js sections.
import { CONFIG, fmt, compassDir, waveColor } from './config.js';

let _data = {}; // keyed by location id

const MARINE_VARS = [
  'wave_height','wave_direction','wave_period',
  'swell_wave_height','swell_wave_direction','swell_wave_period',
  'ocean_current_velocity','ocean_current_direction',
  'wind_speed_10m','wind_direction_10m','wind_gusts_10m',
  'sea_surface_temperature',
].join(',');

const WEATHER_VARS = [
  'temperature_2m','relative_humidity_2m','apparent_temperature',
  'precipitation','cloud_cover','visibility','uv_index',
  'wind_speed_10m','wind_direction_10m','wind_gusts_10m',
].join(',');

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initWeatherLayer() {
  fetchAllLocations();
  setInterval(fetchAllLocations, 600_000); // refresh every 10 min
}

/**
 * Fetch full marine + weather data for any lat/lng.
 * Returns { marine, weather } objects from Open-Meteo.
 */
export async function fetchConditionsAt(lat, lng) {
  const [marine, weather] = await Promise.all([
    fetchMarine(lat, lng),
    fetchWeather(lat, lng),
  ]);
  return { marine, weather };
}

/** Get cached data for a pre-prepared location (or null). */
export function getLocationData(locId) {
  return _data[locId] ?? null;
}

// ── FETCH ─────────────────────────────────────────────────────────────────────

async function fetchAllLocations() {
  await Promise.allSettled(
    CONFIG.locations.map(loc => fetchAndCacheLocation(loc))
  );
}

async function fetchAndCacheLocation(loc) {
  try {
    const { marine, weather } = await fetchConditionsAt(loc.lat, loc.lng);
    // Marine model omits wind for near-shore coords - fill from weather API.
    const mc = marine?.current || {};
    const wc = weather?.current || {};
    if (marine) {
      marine.current = {
        ...mc,
        wind_speed_10m:     mc.wind_speed_10m     ?? wc.wind_speed_10m,
        wind_direction_10m: mc.wind_direction_10m  ?? wc.wind_direction_10m,
        wind_gusts_10m:     mc.wind_gusts_10m      ?? wc.wind_gusts_10m,
      };
    }
    _data[loc.id] = { marine, weather };
  } catch { /* skip if unavailable */ }
}

async function fetchMarine(lat, lng) {
  const url  = `${CONFIG.api.openMeteoMarine}?latitude=${lat}&longitude=${lng}&current=${MARINE_VARS}&wind_speed_unit=kn`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.reason || `Marine API ${resp.status}`);
  }
  return resp.json();
}

async function fetchWeather(lat, lng) {
  const url  = `${CONFIG.api.openMeteoWeather}?latitude=${lat}&longitude=${lng}&current=${WEATHER_VARS}&timezone=Australia%2FSydney`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Weather API ${resp.status}`);
  return resp.json();
}

// ── DRAWER SECTION BUILDERS ───────────────────────────────────────────────────

export function buildMarineSection(c) {
  const wh  = c.wave_height;
  const wp  = c.wave_period;
  const wd  = c.wave_direction;
  const swh = c.swell_wave_height;
  const swp = c.swell_wave_period;
  const swd = c.swell_wave_direction;
  const ws  = c.wind_speed_10m;
  const wdir= c.wind_direction_10m;
  const wg  = c.wind_gusts_10m;
  const sst = c.sea_surface_temperature;
  const cv  = c.ocean_current_velocity;
  const cd  = c.ocean_current_direction;

  return `
    <div class="src-row">
      <span class="src-badge src-om">OPEN-METEO MARINE</span>
      <span class="src-badge src-rt">REAL-TIME</span>
    </div>
    <div class="metrics-grid">
      <div class="mc">
        <div class="mc-icon">🌊</div>
        <div class="mc-val" style="color:${wh!=null?waveColor(wh):'var(--muted)'}">${fmt(wh)}</div>
        <div class="mc-unit">m ${compassDir(wd)}</div>
        <div class="mc-lbl">Wave height</div>
      </div>
      <div class="mc">
        <div class="mc-icon">⏱</div>
        <div class="mc-val" style="color:var(--cyan)">${fmt(wp,0)}</div>
        <div class="mc-unit">seconds</div>
        <div class="mc-lbl">Wave period</div>
      </div>
      <div class="mc">
        <div class="mc-icon">🌡</div>
        <div class="mc-val" style="color:${sstColor(sst||18)}">${fmt(sst)}</div>
        <div class="mc-unit">°C SST</div>
        <div class="mc-lbl">Sea surface</div>
      </div>
      <div class="mc">
        <div class="mc-icon">💨</div>
        <div class="mc-val" style="color:var(--text)">${fmt(ws,0)}</div>
        <div class="mc-unit">kn ${compassDir(wdir)}</div>
        <div class="mc-lbl">Wind</div>
      </div>
      <div class="mc">
        <div class="mc-icon">💥</div>
        <div class="mc-val" style="color:var(--text)">${fmt(wg,0)}</div>
        <div class="mc-unit">kn gusts</div>
        <div class="mc-lbl">Gusts</div>
      </div>
      <div class="mc">
        <div class="mc-icon">🔄</div>
        <div class="mc-val" style="color:var(--lime)">${fmt(cv,2)}</div>
        <div class="mc-unit">m/s ${compassDir(cd)}</div>
        <div class="mc-lbl">Current</div>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <div class="p-label" style="margin-bottom:8px">Swell</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
        <span style="font-family:'Noto Sans',monospace;font-size:20px;color:var(--cyan)">
          ${fmt(swh)}<span style="font-size:12px;color:var(--muted)">m</span>
        </span>
        <span style="font-size:12px;color:var(--muted)">${fmt(swp,0)}s &nbsp; ${compassDir(swd)}</span>
      </div>
      <div class="swell-bar-wrap">
        <div class="swell-bar-fill" style="width:${Math.min(100,(swh||0)/4*100)}%"></div>
      </div>
      <div class="swell-lbl"><span>Calm</span><span>2m</span><span>4m+</span></div>
    </div>
    ${buildWetsuitSection(sst)}`;
}

export function sstColor(t) {
  if (t <= 14) return '#4fc3f7';
  if (t <= 17) return '#00e5ff';
  if (t <= 20) return '#aaff5e';
  if (t <= 23) return '#ffb347';
  return '#ff5f6d';
}

function buildWetsuitSection(sst) {
  if (sst == null) return '';
  let suit, note, color;
  if      (sst < 10) { suit = '7mm Full Suit';     note = `${sst.toFixed(1)}°C - very cold`;  color = 'var(--cyan)'; }
  else if (sst < 22) { suit = '3mm Full Suit';     note = `${sst.toFixed(1)}°C - temperate`;  color = 'var(--lime)'; }
  else               { suit = 'No Wetsuit Needed'; note = `${sst.toFixed(1)}°C - warm water`; color = 'var(--coral)'; }

  return `<div class="d-section">
    <div class="d-section-title">Wetsuit Recommendation</div>
    <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;
      background:rgba(255,255,255,.02);border:1px solid ${color}33;border-radius:9px">
      <div style="font-size:24px">🤿</div>
      <div>
        <div style="font-family:'Noto Sans',monospace;font-size:13px;color:${color};font-weight:600">${suit}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${note}</div>
      </div>
    </div>
  </div>`;
}

export function buildWeatherSection(w) {
  const c    = w?.current || {};
  const uv   = c.uv_index;
  const uvClass = uv >= 8 ? 'color:var(--coral)' : uv >= 6 ? 'color:var(--amber)' : 'color:var(--lime)';

  return `
    <div class="d-section">
      <div class="d-section-title">Weather <span class="api-badge b-om" style="margin-left:4px">OPEN-METEO</span></div>
      <div class="metrics-grid">
        <div class="mc">
          <div class="mc-icon">🌤</div>
          <div class="mc-val">${fmt(c.temperature_2m)}°</div>
          <div class="mc-unit">feels ${fmt(c.apparent_temperature)}°C</div>
          <div class="mc-lbl">Air temp</div>
        </div>
        <div class="mc">
          <div class="mc-icon">☁️</div>
          <div class="mc-val">${fmt(c.cloud_cover,0)}%</div>
          <div class="mc-unit">cloud cover</div>
          <div class="mc-lbl">Sky</div>
        </div>
        <div class="mc">
          <div class="mc-icon">☀️</div>
          <div class="mc-val" style="${uvClass}">${fmt(c.uv_index,1)}</div>
          <div class="mc-unit">UV index</div>
          <div class="mc-lbl">UV</div>
        </div>
      </div>
    </div>`;
}
