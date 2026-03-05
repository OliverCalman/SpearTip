// ── WIND ARROWS ───────────────────────────────────────────────────────────────
// Arrows that slide in the wind direction across a grid of ocean points.
// Architecture:
//   • fetchAndStore()    - fetches Open-Meteo at a 6×4 padded coarse grid.
//                          Voronoi ocean mask applied.  Builds display grid of
//                          ocean points with IDW-interpolated wind per cell.
//   • buildDisplayPoints() - step-grid of latLng points filtered to ocean,
//                          with extra density where wind > 15 kn.
//   • drawFrame(t)       - rAF loop: each point's arrow slides forward/back
//                          along the wind direction using a per-point phase.
//                          Tail length ∝ speed.  Alpha fades at cycle edges.
import { CONFIG } from './config.js';

let _map        = null;
let _canvas     = null;
let _ctx        = null;
let _visible    = true;
let _fetchTimer = null;
let _animFrame  = null;

// Coarse fetch results kept for display rebuild on canvas resize
let _oceanPts   = [];
let _landPts    = [];

// Display layer
let _currentPts = [];    // [{ px, ux, uy, spd, color, key }]
let _phases     = new Map(); // key → phase [0, 1)

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const WIND_ZOOM_MIN = 9;   // hide arrows when viewport > ~200 km (zoom < 9)

const WIND_VARS = 'wind_speed_10m,wind_direction_10m';

// Wind data cache (30 min)
const _cache   = {};
const CACHE_MS = 1_800_000;

// Permanent land/ocean cache
const _isOcean = {};

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initWindLayer(map) {
  _map = map;

  _canvas = document.createElement('canvas');
  _canvas.style.cssText =
    'position:absolute;top:0;left:0;pointer-events:none;z-index:450;';
  map.getContainer().appendChild(_canvas);
  _ctx = _canvas.getContext('2d');

  map.on('moveend zoomend resize', () => scheduleFetch());
  scheduleFetch();
}

export function setWindVisible(on) {
  _visible = on;
  _canvas.style.display = on ? '' : 'none';
  if (on) {
    scheduleFetch();
    if (_animFrame === null) _animFrame = requestAnimationFrame(drawFrame);
  } else {
    cancelAnimationFrame(_animFrame);
    _animFrame = null;
  }
}

// ── FETCH + STORE ─────────────────────────────────────────────────────────────

function scheduleFetch() {
  clearTimeout(_fetchTimer);
  _fetchTimer = setTimeout(fetchAndStore, 200);
}

async function fetchAndStore() {
  if (!_visible || !_map) return;
  if (_map.getZoom() < WIND_ZOOM_MIN) {
    _currentPts = [];
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    return;
  }

  const coarseAll = buildCoarseGrid(6, 4);

  const results = await Promise.allSettled(
    coarseAll.map(p => fetchWindAt(p.lat, p.lng))
  );

  const oceanPts = [];
  const landPts  = [];
  results.forEach((r, i) => {
    const pt = coarseAll[i];
    if (r.status === 'fulfilled' && r.value) {
      oceanPts.push({ lat: pt.lat, lng: pt.lng, ...r.value });
    } else {
      landPts.push(pt);
    }
  });

  if (oceanPts.length === 0) return;

  _oceanPts = oceanPts;
  _landPts  = landPts;

  buildDisplayPoints();
  if (_animFrame === null) _animFrame = requestAnimationFrame(drawFrame);
}

// ── DISPLAY GRID ──────────────────────────────────────────────────────────────

function buildDisplayPoints() {
  if (!_map || !_canvas) return;

  const size = _map.getSize();
  _canvas.width  = size.x;
  _canvas.height = size.y;

  const zoom = _map.getZoom();
  // Step sizes doubled vs previous (halved degrees)
  const step = zoom >= 15 ? 0.006 : zoom >= 13 ? 0.014 : zoom >= 11 ? 0.03 : 0.065;

  const b     = _map.getBounds();
  const south = b.getSouth();
  const north = b.getNorth();
  const west  = b.getWest();
  const east  = b.getEast();

  const pts = [];

  for (let lat = south; lat <= north; lat += step) {
    for (let lng = west; lng <= east; lng += step) {
      const ll = { lat, lng };
      if (!isLikelyOcean(ll, _oceanPts, _landPts)) continue;

      const wind    = interpolateWind(_oceanPts, lat, lng);
      const spd     = wind.speed;
      const toAngle = ((wind.dir + 180) % 360) * Math.PI / 180;
      const ux      =  Math.sin(toAngle);
      const uy      = -Math.cos(toAngle);
      const px      = _map.latLngToContainerPoint(ll);
      const key     = `${lat.toFixed(4)}_${lng.toFixed(4)}`;

      if (!_phases.has(key)) _phases.set(key, Math.random());

      pts.push({ px, ux, uy, spd, color: windColor(spd), key });

      // Extra density in high-wind areas
      if (spd > 15) {
        const half = step / 2;
        for (const [dlat, dlng] of [[half, 0], [-half, 0], [0, half], [0, -half]]) {
          const ll2 = { lat: lat + dlat, lng: lng + dlng };
          if (!isLikelyOcean(ll2, _oceanPts, _landPts)) continue;
          const px2 = _map.latLngToContainerPoint(ll2);
          const k2  = `${(lat + dlat).toFixed(4)}_${(lng + dlng).toFixed(4)}`;
          if (!_phases.has(k2)) _phases.set(k2, Math.random());
          pts.push({ px: px2, ux, uy, spd, color: windColor(spd), key: k2 });
        }
      }
    }
  }

  _currentPts = pts;
}

// ── ANIMATION LOOP ────────────────────────────────────────────────────────────

function drawFrame(t) {
  if (!_visible) { _animFrame = null; return; }

  if (_map.getZoom() < WIND_ZOOM_MIN) {
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    _animFrame = requestAnimationFrame(drawFrame);
    return;
  }

  const size = _map.getSize();
  if (_canvas.width !== size.x || _canvas.height !== size.y) {
    _canvas.width  = size.x;
    _canvas.height = size.y;
    if (_oceanPts.length) buildDisplayPoints();
  }

  const ctx = _ctx;
  const W   = _canvas.width;
  const H   = _canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (_currentPts.length === 0) {
    _animFrame = requestAnimationFrame(drawFrame);
    return;
  }

  const ts = t / 1000;

  ctx.save();
  for (const pt of _currentPts) {
    const { px, ux, uy, spd, color, key } = pt;
    if (px.x < -80 || px.x > W + 80 || px.y < -80 || px.y > H + 80) continue;

    const phase    = _phases.get(key) ?? 0;
    const rate     = Math.max(0.15, spd / 18);
    const frac     = (ts * rate + phase) % 1;
    const travelPx = Math.min(12 + spd * 2.5, 65);
    const offset   = (frac - 0.5) * travelPx;
    const life     = frac < 0.08 ? frac / 0.08
                   : frac > 0.92 ? (1 - frac) / 0.08
                   : 1.0;

    const cx = px.x + ux * offset;
    const cy = px.y + uy * offset;

    const shaftLen = Math.min(8 + spd * 0.9, 24);
    const tailLen  = Math.min(5 + spd * 2.0, 40);
    const headLen  = Math.min(7 + spd * 0.35, 14);
    const spread   = Math.PI / 4.5;
    const arrAngle = Math.atan2(uy, ux);

    const sx0 = cx - ux * shaftLen / 2;
    const sy0 = cy - uy * shaftLen / 2;
    const sx1 = cx + ux * shaftLen / 2;
    const sy1 = cy + uy * shaftLen / 2;
    const tx0 = sx0 - ux * tailLen;
    const ty0 = sy0 - uy * tailLen;

    drawVector(ctx, tx0, ty0, sx0, sy0, sx1, sy1, ux, uy, arrAngle, headLen, spread, color, life);
  }
  ctx.restore();

  _animFrame = requestAnimationFrame(drawFrame);
}

// ── DRAWING ───────────────────────────────────────────────────────────────────

function drawVector(ctx, tx0, ty0, sx0, sy0, sx1, sy1, ux, uy, angle, headLen, spread, color, alpha) {
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineCap     = 'round';

  // Tail
  ctx.lineWidth   = 0.9;
  ctx.globalAlpha = 0.28 * alpha;
  ctx.beginPath();
  ctx.moveTo(tx0, ty0);
  ctx.lineTo(sx0, sy0);
  ctx.stroke();

  // Shaft
  ctx.lineWidth   = 1.3;
  ctx.globalAlpha = 0.50 * alpha;
  ctx.beginPath();
  ctx.moveTo(sx0, sy0);
  ctx.lineTo(sx1 - ux * headLen * 0.5, sy1 - uy * headLen * 0.5);
  ctx.stroke();

  // Head
  ctx.globalAlpha = 0.72 * alpha;
  ctx.beginPath();
  ctx.moveTo(sx1, sy1);
  ctx.lineTo(sx1 - headLen * Math.cos(angle - spread), sy1 - headLen * Math.sin(angle - spread));
  ctx.lineTo(sx1 - headLen * Math.cos(angle + spread), sy1 - headLen * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
}

// ── GRID BUILDERS ─────────────────────────────────────────────────────────────

function buildCoarseGrid(cols, rows) {
  const b      = _map.getBounds();
  const padLat = (b.getNorth() - b.getSouth()) * 0.20;
  const padLng = (b.getEast()  - b.getWest())  * 0.20;
  const south  = b.getSouth() - padLat;
  const north  = b.getNorth() + padLat;
  const west   = b.getWest()  - padLng;
  const east   = b.getEast()  + padLng;

  const pts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push({
        lat: south + (north - south) * ((r + 0.5) / rows),
        lng: west  + (east  - west)  * ((c + 0.5) / cols),
      });
    }
  }
  return pts;
}

// ── OCEAN MASK ────────────────────────────────────────────────────────────────

function isLikelyOcean(pt, oceanPts, landPts) {
  if (oceanPts.length === 0) return false;
  const nearOcean = Math.min(...oceanPts.map(c => dist2(pt, c)));
  if (landPts.length === 0)  return true;
  const nearLand  = Math.min(...landPts.map(c => dist2(pt, c)));
  return nearOcean <= nearLand;
}

function dist2(a, b) {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng);
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchWindAt(lat, lng) {
  const key = `${lat.toFixed(2)}_${lng.toFixed(2)}`;
  if (_isOcean[key] === false) return null;
  if (_cache[key] && Date.now() - _cache[key].fetched < CACHE_MS) return _cache[key];

  try {
    const marineUrl = `${CONFIG.api.openMeteoMarine}` +
      `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=${WIND_VARS}&wind_speed_unit=kn`;
    const resp = await fetch(marineUrl);
    if (!resp.ok) { _isOcean[key] = false; return null; }
    const d = await resp.json();
    const c = d.current || {};

    let speed = c.wind_speed_10m;
    let dir   = c.wind_direction_10m;

    // Marine API omits wind for many ocean/coastal coords - fall back to Weather API
    if (speed == null || dir == null) {
      const wx = await fetchWeatherWindAt(lat, lng);
      if (wx) { speed = wx.speed; dir = wx.dir; }
    }

    const entry = { speed: speed ?? 0, dir: dir ?? 0, fetched: Date.now() };
    _cache[key]   = entry;
    _isOcean[key] = true;
    return entry;
  } catch { return null; }
}

async function fetchWeatherWindAt(lat, lng) {
  try {
    const url = `${CONFIG.api.openMeteoWeather}` +
      `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const d = await resp.json();
    const c = d.current || {};
    return { speed: c.wind_speed_10m ?? null, dir: c.wind_direction_10m ?? null };
  } catch { return null; }
}

// ── IDW INTERPOLATION ─────────────────────────────────────────────────────────

function interpolateWind(data, lat, lng) {
  let wX = 0, wY = 0, wSpd = 0, wTot = 0;
  for (const d of data) {
    const dist = Math.hypot(d.lat - lat, d.lng - lng) + 0.001;
    const w    = 1 / (dist * dist);
    const rad  = d.dir * Math.PI / 180;
    wX   += Math.sin(rad) * w;
    wY   += Math.cos(rad) * w;
    wSpd += d.speed * w;
    wTot += w;
  }
  return {
    speed: wSpd / wTot,
    dir:   ((Math.atan2(wX / wTot, wY / wTot) * 180 / Math.PI) + 360) % 360,
  };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function windColor(spd) {
  if (spd < 5)  return '#00e5ff';
  if (spd < 15) return '#b8d4e8';
  if (spd < 25) return '#ffb347';
  return '#ff5f6d';
}
