// ── WIND VECTOR OVERLAY ────────────────────────────────────────────────────────
// Animated surface-wind arrows on a canvas overlay.
// Architecture:
//   • fetchAndStore()  — fetches Open-Meteo at a 4×3 coarse grid, IDW-
//                        interpolates to a dense display grid, stores in
//                        _currentPts.  Called on moveend/zoomend (debounced).
//   • animateFrame()   — rAF loop that redraws _currentPts every frame.
//                        Each point has a travelling "flow dot" whose position
//                        advances with time, proportional to wind speed.
//   Data is cached 30 min so panning doesn't flood the API.
import { CONFIG } from './config.js';

let _map        = null;
let _canvas     = null;
let _ctx        = null;
let _visible    = true;
let _fetchTimer = null;
let _animFrame  = null;

let _currentPts = [];  // interpolated grid — kept alive between frames

// Per-point phase offsets: key → [0,1) so dots don't all start in sync
const _phases = new Map();

// API result cache: 'lat2_lng2' → { speed, dir, fetched }
const _cache  = {};
const CACHE_MS = 1_800_000; // 30 min

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

  const coarse   = buildGrid(4, 3);
  const windData = await fetchWindGrid(coarse);
  if (windData.length === 0) return;

  _currentPts = buildDisplayGrid().map(pt => ({
    lat: pt.lat,
    lng: pt.lng,
    ...interpolateWind(windData, pt.lat, pt.lng),
  }));

  // Start animation loop if not already running
  if (_animFrame === null) animateFrame();
}

// ── ANIMATION LOOP ────────────────────────────────────────────────────────────

function animateFrame() {
  if (!_visible) { _animFrame = null; return; }

  // Keep canvas sized to map container
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

    const spd   = pt.speed;
    const color = windColor(spd);
    const len   = Math.min(4 + spd * 1.6, 28);

    const toAngle = ((pt.dir + 180) % 360) * Math.PI / 180;
    const dx = Math.sin(toAngle) * len;
    const dy = -Math.cos(toAngle) * len;

    // Static arrow body
    drawArrow(ctx, px.x, px.y, dx, dy, len, color);

    // Animated flow dot: travels from tail to tip
    const key   = ptKey(pt);
    if (!_phases.has(key)) _phases.set(key, Math.random());
    const phase = _phases.get(key);
    const rate  = Math.max(0.25, spd / 12); // faster dot for stronger wind
    const frac  = ((t * rate + phase) % 1);

    const dotX = (px.x - dx / 2) + dx * frac;
    const dotY = (px.y - dy / 2) + dy * frac;
    const dotR = Math.min(1.8 + spd * 0.08, 3.2);

    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

// ── GRID BUILDERS ─────────────────────────────────────────────────────────────

// Sparse coarse grid for API fetches
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

// Dense display grid — step decreases with zoom for more arrows when zoomed in
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

async function fetchWindGrid(pts) {
  const results = await Promise.allSettled(pts.map(p => fetchWindAt(p.lat, p.lng)));
  return results
    .map((r, i) => (r.status === 'fulfilled' && r.value)
      ? { lat: pts[i].lat, lng: pts[i].lng, ...r.value }
      : null)
    .filter(Boolean);
}

async function fetchWindAt(lat, lng) {
  const key = `${lat.toFixed(2)}_${lng.toFixed(2)}`;
  if (_cache[key] && Date.now() - _cache[key].fetched < CACHE_MS) return _cache[key];
  try {
    const url = `${CONFIG.api.openMeteoMarine}` +
      `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=${WIND_VARS}&wind_speed_unit=kn`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const d = await resp.json();
    const c = d.current || {};
    const entry = { speed: c.wind_speed_10m ?? 0, dir: c.wind_direction_10m ?? 0, fetched: Date.now() };
    _cache[key] = entry;
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

function drawArrow(ctx, x, y, dx, dy, len, color) {
  const tx0 = x - dx / 2, ty0 = y - dy / 2; // tail
  const tx1 = x + dx / 2, ty1 = y + dy / 2; // tip

  const headLen  = len * 0.36;
  const toAngle  = Math.atan2(dx, -dy);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineWidth   = 1.2;
  ctx.globalAlpha = 0.55;
  ctx.lineCap     = 'round';

  // Shaft
  ctx.beginPath();
  ctx.moveTo(tx0, ty0);
  ctx.lineTo(tx1, ty1);
  ctx.stroke();

  // Arrowhead
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  ctx.moveTo(tx1, ty1);
  ctx.lineTo(
    tx1 - headLen * Math.sin(toAngle - 0.42),
    ty1 + headLen * Math.cos(toAngle - 0.42)
  );
  ctx.lineTo(
    tx1 - headLen * Math.sin(toAngle + 0.42),
    ty1 + headLen * Math.cos(toAngle + 0.42)
  );
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function windColor(spd) {
  if (spd < 5)  return 'rgba(0,229,255,0.85)';
  if (spd < 15) return 'rgba(184,212,232,0.85)';
  if (spd < 25) return 'rgba(255,179,71,0.85)';
  return 'rgba(255,95,109,0.85)';
}

function ptKey(pt) {
  return `${pt.lat.toFixed(3)}_${pt.lng.toFixed(3)}`;
}
