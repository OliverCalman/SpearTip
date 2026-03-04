// ── WIND PARTICLE SYSTEM ──────────────────────────────────────────────────────
// Animated particle trails showing surface-wind direction and speed.
// Architecture:
//   • fetchAndStore()  — fetches Open-Meteo at a 4×3 coarse grid.
//                        Ocean/land classification via Voronoi boundary.
//                        Builds a pixel-space wind field (FIELD_COLS × FIELD_ROWS)
//                        and ocean spawn points.  Called on moveend/zoomend.
//   • animateFrame()   — rAF loop: fades canvas via destination-out each frame
//                        (producing trails), then moves particles along the wind
//                        field and draws them as small coloured dots.
//                        Particles that drift off-screen or over land respawn
//                        at a random ocean spawn point.
import { CONFIG } from './config.js';

let _map        = null;
let _canvas     = null;
let _ctx        = null;
let _visible    = true;
let _fetchTimer = null;
let _animFrame  = null;

// Coarse fetch results — kept so the wind field can be rebuilt on resize
let _oceanPts = [];   // { lat, lng, speed, dir }
let _landPts  = [];

// Pixel-space wind field built from _oceanPts after each fetch / resize
let _field    = null; // { cols, rows, vx, vy, spd, ocean } — Float32/Uint8 arrays

// Screen-pixel centres of ocean mask cells — particle spawn positions
let _spawnPts = [];

// Live particles
let _particles = [];

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const FIELD_COLS  = 40;
const FIELD_ROWS  = 30;
const SPEED_SCALE = 0.35;   // pixels per frame per knot at 60 fps
const FADE_ALPHA  = 0.05;   // destination-out alpha per frame → ~0.5 s trails
const MAX_AGE     = 220;    // frames before forced respawn (~3.7 s at 60 fps)

// Wind data cache (30 min): 'lat2_lng2' → { speed, dir, fetched }
const _cache   = {};
const CACHE_MS = 1_800_000;

// Permanent land/ocean cache: 'lat2_lng2' → true (ocean) | false (land)
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

  buildWindField();
  spawnParticles();

  if (_animFrame === null) animateFrame();
}

// ── WIND FIELD ────────────────────────────────────────────────────────────────

function buildWindField() {
  if (!_map || !_canvas) return;

  const size = _map.getSize();
  const W    = size.x;
  const H    = size.y;
  const cols = FIELD_COLS;
  const rows = FIELD_ROWS;
  const n    = cols * rows;

  const vx    = new Float32Array(n);
  const vy    = new Float32Array(n);
  const spd   = new Float32Array(n);
  const ocean = new Uint8Array(n);

  const spawnPts = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx  = (c + 0.5) * W / cols;
      const cy  = (r + 0.5) * H / rows;
      const ll  = _map.containerPointToLatLng([cx, cy]);
      const idx = r * cols + c;

      if (!isLikelyOcean(ll, _oceanPts, _landPts)) continue;

      ocean[idx] = 1;
      const wind = interpolateWind(_oceanPts, ll.lat, ll.lng);
      const toAngle = ((wind.dir + 180) % 360) * Math.PI / 180;
      vx[idx]  =  Math.sin(toAngle) * wind.speed * SPEED_SCALE;
      vy[idx]  = -Math.cos(toAngle) * wind.speed * SPEED_SCALE;
      spd[idx] = wind.speed;
      spawnPts.push({ x: cx, y: cy });
    }
  }

  _field    = { cols, rows, W, H, vx, vy, spd, ocean };
  _spawnPts = spawnPts;
}

// O(1) wind field lookup for a screen pixel position
function fieldAt(x, y) {
  if (!_field) return null;
  const { cols, rows, W, H } = _field;
  const c   = Math.min(Math.max(Math.floor(x * cols / W), 0), cols - 1);
  const r   = Math.min(Math.max(Math.floor(y * rows / H), 0), rows - 1);
  const idx = r * cols + c;
  return { vx: _field.vx[idx], vy: _field.vy[idx], spd: _field.spd[idx], ocean: _field.ocean[idx] };
}

// ── PARTICLES ─────────────────────────────────────────────────────────────────

function particleCount() {
  if (!_map) return 400;
  const z = _map.getZoom();
  if (z >= 15) return 900;
  if (z >= 13) return 650;
  if (z >= 11) return 450;
  return 300;
}

function spawnParticles() {
  if (_spawnPts.length === 0) return;
  const count = particleCount();
  _particles  = Array.from({ length: count }, () =>
    newParticle(Math.floor(Math.random() * MAX_AGE))  // stagger ages on init
  );
}

function newParticle(age = 0) {
  if (_spawnPts.length === 0) return { x: 0, y: 0, age: MAX_AGE };
  const sp  = _spawnPts[Math.floor(Math.random() * _spawnPts.length)];
  const cw  = _canvas ? _canvas.width  / FIELD_COLS : 0;
  const ch  = _canvas ? _canvas.height / FIELD_ROWS : 0;
  return {
    x:   sp.x + (Math.random() - 0.5) * cw,
    y:   sp.y + (Math.random() - 0.5) * ch,
    age,
  };
}

// ── ANIMATION LOOP ────────────────────────────────────────────────────────────

function animateFrame() {
  if (!_visible) { _animFrame = null; return; }

  const size = _map.getSize();
  if (_canvas.width !== size.x || _canvas.height !== size.y) {
    _canvas.width  = size.x;
    _canvas.height = size.y;
    // Clear on resize and rebuild field so velocities match new pixel scale
    if (_oceanPts.length) { buildWindField(); spawnParticles(); }
  }

  const ctx = _ctx;
  const W   = _canvas.width;
  const H   = _canvas.height;

  // ── Trail fade: erode existing pixels towards transparent ──────────────────
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0,0,0,${FADE_ALPHA})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  // ── Update + draw particles ────────────────────────────────────────────────
  if (_spawnPts.length > 0) {
    ctx.save();

    for (const p of _particles) {
      const f = fieldAt(p.x, p.y);

      // Respawn if stale, off-screen, or over land
      if (
        p.age >= MAX_AGE ||
        p.x < 0 || p.x > W || p.y < 0 || p.y > H ||
        !f || !f.ocean
      ) {
        const fresh = newParticle();
        p.x   = fresh.x;
        p.y   = fresh.y;
        p.age = 0;
        continue;   // don't draw on spawn frame (avoids flash)
      }

      p.x += f.vx;
      p.y += f.vy;
      p.age++;

      // Fade in at birth, fade out near end of life
      const life  = p.age / MAX_AGE;
      const alpha = life < 0.08 ? life / 0.08
                  : life > 0.75 ? (1 - life) / 0.25
                  : 1;

      ctx.globalAlpha = Math.max(0, alpha) * 0.88;
      ctx.fillStyle   = windColor(f.spd);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.min(1.1 + f.spd * 0.06, 2.1), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _animFrame = requestAnimationFrame(animateFrame);
}

// ── GRID BUILDER ──────────────────────────────────────────────────────────────

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

function windColor(spd) {
  if (spd < 5)  return '#00e5ff';
  if (spd < 15) return '#b8d4e8';
  if (spd < 25) return '#ffb347';
  return '#ff5f6d';
}
