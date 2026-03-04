// ── WIND VECTOR OVERLAY ────────────────────────────────────────────────────────
// Animated arrows with tails over ocean only.
// Architecture:
//   • fetchAndStore()  — fetches Open-Meteo at a 6×4 coarse grid (padded 20%
//                        beyond viewport for realistic edge data).  Ocean/land
//                        classified via Voronoi boundary.  IDW-interpolated wind
//                        stored in _currentPts.  High-wind zones (>15 kn) receive
//                        extra display points at half the base step for denser coverage.
//   • animateFrame()   — rAF loop: draws tail + shaft + arrowhead per point.
//                        Tail length ∝ wind speed.  Travelling dot animates from
//                        tail end to arrow tip, speed ∝ wind speed.
import { CONFIG } from './config.js';

let _map        = null;
let _canvas     = null;
let _ctx        = null;
let _visible    = true;
let _fetchTimer = null;
let _animFrame  = null;

let _currentPts = [];   // ocean display points with interpolated wind

// Per-point staggered animation phase: key → [0,1)
const _phases = new Map();

// Wind data cache (30 min): 'lat2_lng2' → { speed, dir, fetched }
const _cache   = {};
const CACHE_MS = 1_800_000;

// Permanent land/ocean cache (never expires)
const _isOcean = {};

const WIND_VARS = 'wind_speed_10m,wind_direction_10m';

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
    if (_animFrame === null) animateFrame();
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

  // 6×4 = 24 coarse points over padded viewport for realistic edge coverage
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

  // Base display grid step (degrees)
  const zoom = _map.getZoom();
  const step = zoom >= 15 ? 0.012
             : zoom >= 13 ? 0.028
             : zoom >= 11 ? 0.06
             : 0.13;

  // Filter to ocean-only and IDW-interpolate
  const basePts = buildDisplayGrid(step)
    .filter(pt => isLikelyOcean(pt, oceanPts, landPts))
    .map(pt => ({ lat: pt.lat, lng: pt.lng, ...interpolateWind(oceanPts, pt.lat, pt.lng) }));

  // Extra density in high-wind zones: insert midpoints around fast cells
  const HIGH_WIND_KN = 15;
  const half = step / 2;
  const seen = new Set(basePts.map(p => ptKey(p)));
  const extraPts = [];
  for (const pt of basePts) {
    if (pt.speed > HIGH_WIND_KN) {
      for (const [dlat, dlng] of [[-half, 0], [half, 0], [0, -half], [0, half]]) {
        const ep = { lat: pt.lat + dlat, lng: pt.lng + dlng };
        const k  = ptKey(ep);
        if (!seen.has(k) && isLikelyOcean(ep, oceanPts, landPts)) {
          seen.add(k);
          extraPts.push({ ...ep, ...interpolateWind(oceanPts, ep.lat, ep.lng) });
        }
      }
    }
  }

  _currentPts = [...basePts, ...extraPts];

  if (_animFrame === null) animateFrame();
}

// ── ANIMATION LOOP ────────────────────────────────────────────────────────────

function animateFrame() {
  if (!_visible) { _animFrame = null; return; }

  const size = _map.getSize();
  if (_canvas.width !== size.x || _canvas.height !== size.y) {
    _canvas.width  = size.x;
    _canvas.height = size.y;
  }

  drawFrame(performance.now() / 1000);
  _animFrame = requestAnimationFrame(animateFrame);
}

function drawFrame(t) {
  const ctx = _ctx;
  const W   = _canvas.width;
  const H   = _canvas.height;
  ctx.clearRect(0, 0, W, H);

  for (const pt of _currentPts) {
    const px = _map.latLngToContainerPoint([pt.lat, pt.lng]);
    if (px.x < -80 || px.y < -80 || px.x > W + 80 || px.y > H + 80) continue;

    const spd      = pt.speed;
    const color    = windColor(spd);
    const toAngle  = ((pt.dir + 180) % 360) * Math.PI / 180;
    const ux       = Math.sin(toAngle);
    const uy       = -Math.cos(toAngle);

    const shaftLen = Math.min(8 + spd * 0.9, 24);
    const tailLen  = Math.min(5 + spd * 2.0, 40);  // long tail = strong wind
    const headLen  = Math.min(6 + spd * 0.30, 12);
    const spread   = Math.PI / 4.5;
    const arrAngle = Math.atan2(uy, ux);

    // Animate the whole arrow sliding in the wind direction
    const key  = ptKey(pt);
    if (!_phases.has(key)) _phases.set(key, Math.random());
    const phase     = _phases.get(key);
    const rate      = Math.max(0.15, spd / 18);   // cycles/s — faster = stronger wind
    const frac      = (t * rate + phase) % 1;
    const travelPx  = Math.min(12 + spd * 2.5, 65);
    const offset    = (frac - 0.5) * travelPx;    // moves ±half-travel from grid point

    // Smooth fade in/out at cycle boundaries to avoid a hard jump
    const life = frac < 0.08 ? frac / 0.08 : frac > 0.92 ? (1 - frac) / 0.08 : 1.0;

    const cx  = px.x + ux * offset;
    const cy  = px.y + uy * offset;
    const sx0 = cx - ux * shaftLen / 2;
    const sy0 = cy - uy * shaftLen / 2;
    const sx1 = cx + ux * shaftLen / 2;
    const sy1 = cy + uy * shaftLen / 2;
    const tx0 = sx0 - ux * tailLen;
    const ty0 = sy0 - uy * tailLen;

    drawVector(ctx, tx0, ty0, sx0, sy0, sx1, sy1, ux, uy, arrAngle, headLen, spread, color, life);
  }
}

// ── DRAWING ───────────────────────────────────────────────────────────────────

function drawVector(ctx, tx0, ty0, sx0, sy0, sx1, sy1, ux, uy, angle, headLen, spread, color, alpha) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineCap     = 'round';

  // Tail: thin, faint — longer tail = stronger wind
  ctx.lineWidth   = 0.9;
  ctx.globalAlpha = 0.28 * alpha;
  ctx.beginPath();
  ctx.moveTo(tx0, ty0);
  ctx.lineTo(sx0, sy0);
  ctx.stroke();

  // Shaft: stops short of tip to leave room for the head
  ctx.lineWidth   = 1.3;
  ctx.globalAlpha = 0.50 * alpha;
  ctx.beginPath();
  ctx.moveTo(sx0, sy0);
  ctx.lineTo(sx1 - ux * headLen * 0.5, sy1 - uy * headLen * 0.5);
  ctx.stroke();

  // Arrowhead: solid filled triangle
  ctx.globalAlpha = 0.72 * alpha;
  ctx.beginPath();
  ctx.moveTo(sx1, sy1);
  ctx.lineTo(sx1 - headLen * Math.cos(angle - spread), sy1 - headLen * Math.sin(angle - spread));
  ctx.lineTo(sx1 - headLen * Math.cos(angle + spread), sy1 - headLen * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ── GRID BUILDERS ─────────────────────────────────────────────────────────────

// Coarse fetch grid: 20% padding beyond viewport for better edge accuracy
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

function buildDisplayGrid(step) {
  const b   = _map.getBounds();
  const pts = [];
  for (let lat = b.getSouth() + step / 2; lat < b.getNorth(); lat += step) {
    for (let lng = b.getWest() + step / 2; lng < b.getEast(); lng += step) {
      pts.push({ lat, lng });
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

  if (_cache[key] && Date.now() - _cache[key].fetched < CACHE_MS) {
    return _cache[key];
  }

  try {
    const url = `${CONFIG.api.openMeteoMarine}` +
      `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=${WIND_VARS}&wind_speed_unit=kn`;
    const resp = await fetch(url);
    if (!resp.ok) {
      _isOcean[key] = false;
      return null;
    }
    const d     = await resp.json();
    const c     = d.current || {};
    const entry = { speed: c.wind_speed_10m ?? 0, dir: c.wind_direction_10m ?? 0, fetched: Date.now() };
    _cache[key]   = entry;
    _isOcean[key] = true;
    return entry;
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

function ptKey(pt) {
  return `${pt.lat.toFixed(3)}_${pt.lng.toFixed(3)}`;
}
