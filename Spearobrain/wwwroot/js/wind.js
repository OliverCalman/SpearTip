// ── WIND VECTOR OVERLAY ────────────────────────────────────────────────────────
// Animated surface-wind lines on a canvas overlay.
// Architecture:
//   • fetchAndStore()  — fetches Open-Meteo at a 4×3 coarse grid.
//                        Coarse points that return null are land; those that
//                        return data are ocean.  Display grid points are only
//                        kept if their nearest ocean coarse point is closer
//                        than their nearest land coarse point (Voronoi land mask).
//                        Remaining points are IDW-interpolated and stored in
//                        _currentPts.  Called on moveend/zoomend (debounced).
//   • animateFrame()   — rAF loop: draws a static line + a travelling dot per
//                        point.  Dot speed is proportional to wind speed so
//                        direction and strength are both visible.
import { CONFIG } from './config.js';

let _map        = null;
let _canvas     = null;
let _ctx        = null;
let _visible    = true;
let _fetchTimer = null;
let _animFrame  = null;

let _currentPts = [];   // ocean display points with interpolated wind data

// Per-point staggered phase: key → [0,1)
const _phases  = new Map();

// Wind data cache (30 min): 'lat2_lng2' → { speed, dir, fetched }
const _cache   = {};
const CACHE_MS = 1_800_000;

// Permanent land/ocean cache: 'lat2_lng2' → true (ocean) | false (land)
// Land/ocean status never changes so no expiry.
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

  const coarseAll = buildGrid(4, 3);

  // Fetch all coarse points, separating ocean from land
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

  // Build display grid, keeping only points that are likely over water
  const displayPts = buildDisplayGrid()
    .filter(pt => isLikelyOcean(pt, oceanPts, landPts));

  _currentPts = displayPts.map(pt => ({
    lat: pt.lat,
    lng: pt.lng,
    ...interpolateWind(oceanPts, pt.lat, pt.lng),
  }));

  if (_animFrame === null) animateFrame();
}

// A display point is considered ocean when its nearest ocean coarse point
// is closer than its nearest land coarse point (Voronoi boundary).
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
  ctx.clearRect(0, 0, _canvas.width, _canvas.height);

  for (const pt of _currentPts) {
    const px = _map.latLngToContainerPoint([pt.lat, pt.lng]);
    if (px.x < -30 || px.y < -30 ||
        px.x > _canvas.width + 30 || px.y > _canvas.height + 30) continue;

    const spd      = pt.speed;
    const color    = windColor(spd);
    const len      = Math.min(4 + spd * 1.6, 28);
    const toAngle  = ((pt.dir + 180) % 360) * Math.PI / 180;
    const dx       = Math.sin(toAngle) * len;
    const dy       = -Math.cos(toAngle) * len;

    // Static line (no arrowhead)
    drawLine(ctx, px.x, px.y, dx, dy, color);

    // Travelling dot along the line (direction + speed indicator)
    const key   = ptKey(pt);
    if (!_phases.has(key)) _phases.set(key, Math.random());
    const phase = _phases.get(key);
    const rate  = Math.max(0.25, spd / 12);
    const frac  = (t * rate + phase) % 1;

    const dotX = (px.x - dx / 2) + dx * frac;
    const dotY = (px.y - dy / 2) + dy * frac;
    const dotR = Math.min(1.6 + spd * 0.07, 2.8);

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── GRID BUILDERS ─────────────────────────────────────────────────────────────

function buildGrid(cols, rows) {
  const b   = _map.getBounds();
  const pts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push({
        lat: b.getSouth() + (b.getNorth() - b.getSouth()) * ((r + 0.5) / rows),
        lng: b.getWest()  + (b.getEast()  - b.getWest())  * ((c + 0.5) / cols),
      });
    }
  }
  return pts;
}

function buildDisplayGrid() {
  const zoom = _map.getZoom();
  const step = zoom >= 15 ? 0.012
             : zoom >= 13 ? 0.030
             : zoom >= 11 ? 0.065
             : 0.13;

  const b   = _map.getBounds();
  const pts = [];
  for (let lat = b.getSouth() + step / 2; lat < b.getNorth(); lat += step) {
    for (let lng = b.getWest() + step / 2; lng < b.getEast(); lng += step) {
      pts.push({ lat, lng });
    }
  }
  return pts;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchWindAt(lat, lng) {
  const key = `${lat.toFixed(2)}_${lng.toFixed(2)}`;

  // Permanent land cache: if we already know this point is land, skip fetch
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
      _isOcean[key] = false; // land — remember permanently
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

// ── DRAWING ───────────────────────────────────────────────────────────────────

function drawLine(ctx, x, y, dx, dy, color) {
  const tx0 = x - dx / 2, ty0 = y - dy / 2;
  const tx1 = x + dx / 2, ty1 = y + dy / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.0;
  ctx.globalAlpha = 0.42;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(tx0, ty0);
  ctx.lineTo(tx1, ty1);
  ctx.stroke();
  ctx.restore();
}

function windColor(spd) {
  if (spd < 5)  return 'rgba(0,229,255,1)';
  if (spd < 15) return 'rgba(184,212,232,1)';
  if (spd < 25) return 'rgba(255,179,71,1)';
  return 'rgba(255,95,109,1)';
}

function ptKey(pt) {
  return `${pt.lat.toFixed(3)}_${pt.lng.toFixed(3)}`;
}
