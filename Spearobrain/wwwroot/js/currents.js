// ── OCEAN CURRENTS ────────────────────────────────────────────────────────────
// Canvas particle system driven by U/V vectors sampled from Open-Meteo Marine
// at a GRID_COLS×GRID_ROWS viewport grid (same NEMO backbone as CMEMS).
// Strong-current areas produce fast, bright particles - useful for spearfishing
// planning (channel currents concentrate baitfish and pelagics).
import { CONFIG } from './config.js';

const NPARTS    = 500;
const FETCH_MS  = 600_000;
const GRID_COLS = 4;
const GRID_ROWS = 3;
const ZOOM_MIN  = 12;

let _map            = null;
let _canvas         = null;
let _ctx            = null;
let _running        = true;
let _raf            = null;
let _parts          = [];
let _currentVectors = [];
let _fetching       = false;

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initCurrentsLayer(map) {
  _map    = map;
  _canvas = document.getElementById('current-canvas');
  _ctx    = _canvas.getContext('2d');

  resize();
  window.addEventListener('resize', resize);

  rebuildGrid();
  fetchAllCurrents();
  initParts();
  animate();

  map.on('moveend', () => {
    if (_map.getZoom() < ZOOM_MIN) return;
    rebuildGrid();
    fetchAllCurrents();
    if (_running) initParts();
  });

  setInterval(() => { if (_currentVectors.length) fetchAllCurrents(); }, FETCH_MS);
}

export function setCurrentsVisible(on) {
  _running = on;
  if (on) { initParts(); animate(); }
  else    { cancelAnimationFrame(_raf); _ctx.clearRect(0, 0, _canvas.width, _canvas.height); }
}

// ── VIEWPORT GRID ─────────────────────────────────────────────────────────────

function rebuildGrid() {
  const bounds  = _map.getBounds();
  const latStep = (bounds.getNorth() - bounds.getSouth()) / GRID_ROWS;
  const lngStep = (bounds.getEast()  - bounds.getWest())  / GRID_COLS;

  _currentVectors = [];
  for (let r = 0; r <= GRID_ROWS; r++) {
    for (let c = 0; c <= GRID_COLS; c++) {
      _currentVectors.push({
        lat: bounds.getSouth() + r * latStep,
        lng: bounds.getWest()  + c * lngStep,
        u: null, v: null,
      });
    }
  }
}

// ── FETCH ─────────────────────────────────────────────────────────────────────

async function fetchAllCurrents() {
  if (_fetching) return;
  _fetching = true;
  await Promise.allSettled(_currentVectors.map((cv, i) => fetchCurrent(cv, i)));
  _fetching = false;
}

async function fetchCurrent(cv, idx) {
  try {
    const url  = `${CONFIG.api.openMeteoMarine}?latitude=${cv.lat.toFixed(4)}&longitude=${cv.lng.toFixed(4)}` +
                 `&current=ocean_current_velocity,ocean_current_direction`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const d   = await resp.json();
    const c   = d.current || {};
    const vel = c.ocean_current_velocity  ?? 0;
    const dir = c.ocean_current_direction ?? 0;
    const rad = dir * Math.PI / 180;
    // Oceanographic bearing CW from N - 0°=flowing north, 90°=flowing east
    _currentVectors[idx].u = vel * Math.sin(rad);
    _currentVectors[idx].v = vel * Math.cos(rad);
  } catch { /* point stays null - skipped in interpolation */ }
}

// ── PARTICLE SYSTEM ───────────────────────────────────────────────────────────

function resize() {
  _canvas.width  = window.innerWidth;
  _canvas.height = window.innerHeight;
}

function initParts() {
  _parts = Array.from({ length: NPARTS }, () => spawnPart());
}

function spawnPart(x, y) {
  return {
    x:      x ?? Math.random() * _canvas.width,
    y:      y ?? Math.random() * _canvas.height,
    age:    0,
    maxAge: 120 + Math.random() * 180,
    sz:     0.7 + Math.random() * 1.1,
  };
}

function hasLiveData() {
  return _currentVectors.some(cv => cv.u !== null);
}

// Inverse-distance weighted interpolation of (u, v) at canvas pixel (px, py)
function interpolateUV(px, py) {
  const ll = _map.containerPointToLatLng([px, py]);
  let sumW = 0, sumU = 0, sumV = 0;

  for (const cv of _currentVectors) {
    if (cv.u === null) continue;
    const dLat  = ll.lat - cv.lat;
    const dLng  = ll.lng - cv.lng;
    const dist2 = dLat * dLat + dLng * dLng + 0.005;
    const w     = 1 / dist2;
    sumW += w; sumU += w * cv.u; sumV += w * cv.v;
  }
  return sumW === 0 ? null : { u: sumU / sumW, v: sumV / sumW };
}

// ── ANIMATION LOOP ────────────────────────────────────────────────────────────

function animate() {
  if (!_running) return;

  if (!hasLiveData() || _map.getZoom() < ZOOM_MIN) {
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    _raf = requestAnimationFrame(animate);
    return;
  }

  // Very slow fade → long persistent trails
  _ctx.fillStyle = 'rgba(5,14,26,.04)';
  _ctx.fillRect(0, 0, _canvas.width, _canvas.height);

  for (let i = 0; i < _parts.length; i++) {
    const p  = _parts[i];
    const uv = interpolateUV(p.x, p.y);

    if (!uv) { _parts[i] = spawnPart(); continue; }

    const ll    = _map.containerPointToLatLng([p.x, p.y]);
    const right = _map.latLngToContainerPoint([ll.lat, ll.lng + 0.01]);
    const up    = _map.latLngToContainerPoint([ll.lat + 0.01, ll.lng]);
    const rMag  = Math.hypot(right.x - p.x, right.y - p.y) || 1;
    const uMag  = Math.hypot(up.x   - p.x, up.y   - p.y) || 1;
    const ex    = (right.x - p.x) / rMag;
    const ey    = (right.y - p.y) / rMag;
    const nx2   = (up.x - p.x) / uMag;
    const ny2   = (up.y - p.y) / uMag;

    // Scale speed: stronger currents → faster particles and brighter colour
    const speed = Math.hypot(uv.u, uv.v);
    const scale = 3.0 + speed * 6.0;
    const dx = (uv.u * ex + uv.v * nx2) * scale;
    const dy = (uv.u * ey + uv.v * ny2) * scale;

    const ox = p.x, oy = p.y;
    p.x += dx; p.y += dy; p.age++;

    if (p.age > p.maxAge || p.x < 0 || p.x > _canvas.width || p.y < 0 || p.y > _canvas.height) {
      _parts[i] = spawnPart();
      continue;
    }

    const life   = Math.min(p.age / 15, 1) * Math.min((p.maxAge - p.age) / 15, 1);
    // Stronger currents → cyan tint; weak → near-white
    const bright = Math.min(speed * 2.5, 1.0);
    const r      = Math.round(180 + (1 - bright) * 30);
    const g      = Math.round(220 + (1 - bright) * 15);

    _ctx.beginPath();
    _ctx.moveTo(ox, oy);
    _ctx.lineTo(p.x, p.y);
    _ctx.strokeStyle = `rgba(${r},${g},255,${life * 0.75})`;
    _ctx.lineWidth   = p.sz;
    _ctx.lineCap     = 'round';
    _ctx.stroke();
  }

  _raf = requestAnimationFrame(animate);
}
