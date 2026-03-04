// ── WIND VECTOR OVERLAY ────────────────────────────────────────────────────────
// Draws live surface-wind arrows on a canvas overlaid on the map.
// Fetches from Open-Meteo Marine API at a coarse 4×3 grid, IDW-interpolates
// to a display grid whose density scales with zoom level, then renders arrows.
import { CONFIG } from './config.js';

let _map      = null;
let _canvas   = null;
let _ctx      = null;
let _visible  = true;
let _timer    = null;

// Cache: 'lat2_lng2' → { speed, dir, fetched }
const _cache  = {};
const CACHE_MS = 1_800_000; // 30 min — wind changes slowly enough

const WIND_VARS = 'wind_speed_10m,wind_direction_10m';

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initWindLayer(map) {
  _map = map;

  _canvas = document.createElement('canvas');
  _canvas.style.cssText =
    'position:absolute;top:0;left:0;pointer-events:none;z-index:450;';
  map.getContainer().appendChild(_canvas);
  _ctx = _canvas.getContext('2d');

  map.on('moveend zoomend resize', () => scheduleDraw());
  scheduleDraw();
}

export function setWindVisible(on) {
  _visible = on;
  _canvas.style.display = on ? '' : 'none';
  if (on) scheduleDraw();
}

// ── INTERNAL ──────────────────────────────────────────────────────────────────

function scheduleDraw() {
  clearTimeout(_timer);
  _timer = setTimeout(fetchAndDraw, 150); // debounce after pan/zoom
}

async function fetchAndDraw() {
  if (!_visible || !_map) return;

  const size = _map.getSize();
  _canvas.width  = size.x;
  _canvas.height = size.y;

  // Fetch at a coarse 4×3 grid covering the viewport
  const coarse = buildGrid(4, 3);
  const windData = await fetchWindGrid(coarse);
  if (windData.length === 0) return;

  // Display grid density based on zoom
  const displayPts = buildDisplayGrid();

  // IDW-interpolate wind vectors to display grid
  const interpolated = displayPts.map(pt => ({
    lat: pt.lat,
    lng: pt.lng,
    ...interpolateWind(windData, pt.lat, pt.lng),
  }));

  drawArrows(interpolated);
}

// Build a cols×rows grid of lat/lng points inside current bounds
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

// Display grid: step size decreases as zoom increases (more arrows when zoomed in)
function buildDisplayGrid() {
  const zoom = _map.getZoom();
  const step = zoom >= 15 ? 0.025
             : zoom >= 13 ? 0.05
             : zoom >= 11 ? 0.10
             : 0.20;

  const b   = _map.getBounds();
  const pts = [];
  for (let lat = b.getSouth() + step / 2; lat < b.getNorth(); lat += step) {
    for (let lng = b.getWest() + step / 2; lng < b.getEast(); lng += step) {
      pts.push({ lat, lng });
    }
  }
  return pts;
}

// ── DATA FETCHING ─────────────────────────────────────────────────────────────

async function fetchWindGrid(pts) {
  const results = await Promise.allSettled(
    pts.map(p => fetchWindAt(p.lat, p.lng))
  );
  return results
    .map((r, i) => {
      if (r.status !== 'fulfilled' || !r.value) return null;
      return { lat: pts[i].lat, lng: pts[i].lng, ...r.value };
    })
    .filter(Boolean);
}

async function fetchWindAt(lat, lng) {
  const key = `${lat.toFixed(2)}_${lng.toFixed(2)}`;
  if (_cache[key] && Date.now() - _cache[key].fetched < CACHE_MS) {
    return _cache[key];
  }
  try {
    const url = `${CONFIG.api.openMeteoMarine}` +
      `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=${WIND_VARS}&wind_speed_unit=kn`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const d = await resp.json();
    const c = d.current || {};
    const entry = {
      speed:  c.wind_speed_10m  ?? 0,
      dir:    c.wind_direction_10m ?? 0,
      fetched: Date.now(),
    };
    _cache[key] = entry;
    return entry;
  } catch { return null; }
}

// ── IDW INTERPOLATION ─────────────────────────────────────────────────────────

// Inverse-distance weighting interpolation for wind speed + direction.
// Direction is interpolated via unit-vector components to avoid wrap-around issues.
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
  const speed = wSpd / wTot;
  const dir   = ((Math.atan2(wX / wTot, wY / wTot) * 180 / Math.PI) + 360) % 360;
  return { speed, dir };
}

// ── CANVAS RENDERING ──────────────────────────────────────────────────────────

function drawArrows(pts) {
  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

  for (const pt of pts) {
    const px = _map.latLngToContainerPoint([pt.lat, pt.lng]);
    if (px.x < 0 || px.y < 0 || px.x > _canvas.width || px.y > _canvas.height) continue;

    const spd   = pt.speed;
    const color = spd < 5  ? 'rgba(0,229,255,0.50)'
                : spd < 15 ? 'rgba(184,212,232,0.60)'
                : spd < 25 ? 'rgba(255,179,71,0.68)'
                :             'rgba(255,95,109,0.75)';

    const len = Math.min(4 + spd * 1.5, 26); // 4 px calm → 26 px strong
    drawArrow(_ctx, px.x, px.y, pt.dir, len, color);
  }
}

function drawArrow(ctx, x, y, dirDeg, len, color) {
  // Wind direction is meteorological (FROM). Arrow points INTO the wind (TO).
  const toAngle = ((dirDeg + 180) % 360) * Math.PI / 180;
  const headLen = len * 0.38;

  const dx = Math.sin(toAngle) * len;
  const dy = -Math.cos(toAngle) * len;

  // Tail and tip
  const tx0 = x - dx / 2, ty0 = y - dy / 2; // tail
  const tx1 = x + dx / 2, ty1 = y + dy / 2; // tip

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineWidth   = 1.3;
  ctx.lineCap     = 'round';

  // Shaft
  ctx.beginPath();
  ctx.moveTo(tx0, ty0);
  ctx.lineTo(tx1, ty1);
  ctx.stroke();

  // Arrowhead (filled triangle at tip)
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
