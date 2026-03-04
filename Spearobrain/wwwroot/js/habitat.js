// ── HABITAT LAYER: KELP, CORAL & SEAGRASS ZONES ──────────────────────────────
// ALA occurrence records → connected-components clustering (100 m eps) →
// each cluster expanded by a 130 m buffer per point → convex hull →
// Chaikin-smoothed polygon.  Gives ArcGIS-style organic zones that follow
// the actual spatial distribution of sightings along reefs.
import { CONFIG } from './config.js';

let _map      = null;
let _group    = null;
let _visible  = true;
let _lastBbox = null;
let _loading  = false;

const ZOOM_THRESHOLD = 11;
const CLUSTER_EPS    = 0.001;   // ~100 m — connects only genuinely nearby records
const BUF_M          = 130;     // metres buffer radius per occurrence point
const BUF_APPROX     = 12;      // circle approximation vertices per point
const CHAIKIN_ITER   = 2;       // Chaikin smoothing passes

const HABITAT_SPECIES = [
  { key: 'kelp',     name: 'Bull Kelp / Ecklonia',  color: '#2d8a2d' },
  { key: 'coral',    name: 'Hard Coral',             color: '#ff8c42' },
  { key: 'seagrass', name: 'Posidonia Seagrass',     color: '#5cb85c' },
];

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initHabitatLayer(map) {
  _map   = map;
  _group = L.layerGroup();
  map.on('zoomend moveend', onMapChange);
}

export function setHabitatVisible(on) {
  _visible = on;
  if (!on) {
    if (_map.hasLayer(_group)) _map.removeLayer(_group);
  } else {
    onMapChange();
  }
}

// ── EVENT HANDLER ─────────────────────────────────────────────────────────────

function onMapChange() {
  if (!_visible) return;
  if (_map.getZoom() < ZOOM_THRESHOLD) {
    if (_map.hasLayer(_group)) _map.removeLayer(_group);
    return;
  }
  const bounds = _map.getBounds();
  const bbox   = bboxKey(bounds);
  if (bbox === _lastBbox || _loading) return;
  _lastBbox = bbox;
  loadHabitat(bounds);
}

// ── DATA FETCHING ─────────────────────────────────────────────────────────────

async function loadHabitat(bounds) {
  _loading = true;
  _group.clearLayers();

  const minLat  = bounds.getSouth().toFixed(4);
  const maxLat  = bounds.getNorth().toFixed(4);
  const minLng  = bounds.getWest().toFixed(4);
  const maxLng  = bounds.getEast().toFixed(4);
  const centLat = (bounds.getSouth() + bounds.getNorth()) / 2;

  try {
    const resp = await fetch(
      `${CONFIG.api.habitat}?minLat=${minLat}&minLng=${minLng}&maxLat=${maxLat}&maxLng=${maxLng}`
    );
    if (!resp.ok) throw new Error();
    const results = await resp.json();

    let anyData = false;
    results.forEach(item => {
      const sp = HABITAT_SPECIES.find(s => s.key === item?.type);
      if (!sp || !Array.isArray(item.occurrences)) return;

      const pts = item.occurrences
        .filter(o => o?.decimalLatitude && o?.decimalLongitude)
        .map(o => [+o.decimalLatitude, +o.decimalLongitude]);

      if (pts.length) {
        renderZones(pts, sp, 'ALA occurrence data', centLat);
        anyData = true;
      }
    });

    if (!anyData) addKnownSites(bounds, centLat);
  } catch {
    addKnownSites(bounds, centLat);
  } finally {
    if (_visible && _map.getZoom() >= ZOOM_THRESHOLD) {
      if (!_map.hasLayer(_group)) _group.addTo(_map);
    }
    _loading = false;
  }
}

// ── ZONE RENDERING ────────────────────────────────────────────────────────────

function renderZones(pts, sp, source, centLat) {
  clusterPoints(pts).forEach(cluster => {
    const label = `${cluster.length} record${cluster.length !== 1 ? 's' : ''}`;
    const popup = `<div style="font-family:'Noto Sans',monospace;font-size:11px;color:${sp.color};font-weight:600">${sp.name}</div>
      <div style="font-size:10px;color:#b8d4e8;margin-top:4px">${source}</div>
      <div style="font-size:9px;color:#3a5a78;margin-top:2px">${label} in zone</div>`;

    const zone = buildZonePolygon(cluster, centLat);
    L.polygon(zone, {
      color:       sp.color,
      fillColor:   sp.color,
      fillOpacity: Math.min(0.12 + cluster.length * 0.008, 0.28),
      weight:      1.5,
      opacity:     0.8,
      dashArray:   '5 4',
    })
    .bindPopup(popup, { className: 'tw-popup' })
    .addTo(_group);
  });
}

// ── GEOMETRY ──────────────────────────────────────────────────────────────────

// Connected-components clustering: groups points within CLUSTER_EPS degrees.
function clusterPoints(pts) {
  const n       = pts.length;
  const visited = new Uint8Array(n);
  const result  = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    const group = [pts[i]];
    const queue = [i];
    while (queue.length) {
      const cur = queue.shift();
      for (let j = 0; j < n; j++) {
        if (visited[j]) continue;
        const dLat = pts[cur][0] - pts[j][0];
        const dLng = pts[cur][1] - pts[j][1];
        if (Math.hypot(dLat, dLng) <= CLUSTER_EPS) {
          visited[j] = 1;
          group.push(pts[j]);
          queue.push(j);
        }
      }
    }
    result.push(group);
  }
  return result;
}

// Buffer each occurrence point by BUF_M metres (via circle approximation),
// take convex hull of the expanded point cloud, then Chaikin-smooth.
// This gives organic zone shapes that follow the real sighting distribution.
function buildZonePolygon(pts, centLat) {
  const latBuf = BUF_M / 111000;
  const lngBuf = BUF_M / (111000 * Math.cos(centLat * Math.PI / 180));

  const expanded = [];
  for (const [lat, lng] of pts) {
    for (let a = 0; a < BUF_APPROX; a++) {
      const angle = (a / BUF_APPROX) * Math.PI * 2;
      expanded.push([
        lat + Math.sin(angle) * latBuf,
        lng + Math.cos(angle) * lngBuf,
      ]);
    }
  }
  return chaikin(convexHull(expanded), CHAIKIN_ITER);
}

// Monotone-chain convex hull — returns CCW hull.
function convexHull(pts) {
  if (pts.length <= 2) return pts;
  const sorted = [...pts].sort((a, b) => a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]);
  const cross  = (o, a, b) => (a[1]-o[1])*(b[0]-o[0]) - (a[0]-o[0])*(b[1]-o[1]);

  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

// Chaikin corner-cutting for smooth, organic-looking polygon outlines.
function chaikin(pts, iterations) {
  let h = pts;
  for (let iter = 0; iter < iterations; iter++) {
    const next = [];
    for (let i = 0; i < h.length; i++) {
      const p0 = h[i], p1 = h[(i + 1) % h.length];
      next.push([0.75*p0[0] + 0.25*p1[0], 0.75*p0[1] + 0.25*p1[1]]);
      next.push([0.25*p0[0] + 0.75*p1[0], 0.25*p0[1] + 0.75*p1[1]]);
    }
    h = next;
  }
  return h;
}

// ── FALLBACK: KNOWN HABITAT SITES ─────────────────────────────────────────────

function addKnownSites(bounds, centLat) {
  // Multi-point clusters per site so the zone algorithm produces proper zones.
  const sites = [
    // Cabbage Tree Bay kelp forest (~200m reef strip)
    { pts:[[-33.7982,151.2941],[-33.7988,151.2947],[-33.7994,151.2952],[-33.7978,151.2938]], type:'kelp',     name:'Cabbage Tree Bay Kelp' },
    // Shelly Beach kelp
    { pts:[[-33.8018,151.2908],[-33.8024,151.2914],[-33.8021,151.2921]], type:'kelp',     name:'Shelly Beach Kelp' },
    // Freshwater reef kelp
    { pts:[[-33.7697,151.2916],[-33.7703,151.2922],[-33.7709,151.2919]], type:'kelp',     name:'Freshwater Reef Kelp' },
    // Malabar reef kelp
    { pts:[[-33.9678,151.2447],[-33.9684,151.2454],[-33.9681,151.2461]], type:'kelp',     name:'Malabar Reef Kelp' },
    // Manly head coral/reef
    { pts:[[-33.7948,151.2958],[-33.7954,151.2964],[-33.7950,151.2971]], type:'coral',    name:'Manly Head Reef' },
    // Malabar head reef
    { pts:[[-33.9718,151.2427],[-33.9724,151.2434],[-33.9720,151.2441]], type:'coral',    name:'Malabar Head Reef' },
    // Manly Cove seagrass
    { pts:[[-33.8008,151.2877],[-33.8012,151.2884],[-33.8016,151.2879]], type:'seagrass', name:'Manly Cove Seagrass' },
  ];

  sites.forEach(site => {
    if (!site.pts.some(p => bounds.contains(p))) return;
    const sp = HABITAT_SPECIES.find(s => s.key === site.type);
    if (!sp) return;
    const popup = `<div style="font-family:'Noto Sans',monospace;font-size:11px;color:${sp.color};font-weight:600">${site.name}</div>
      <div style="font-size:10px;color:#3a5a78;margin-top:4px">${sp.name} — known site</div>`;
    const zone = buildZonePolygon(site.pts, centLat);
    L.polygon(zone, { color: sp.color, fillColor: sp.color, fillOpacity: 0.15, weight: 1.5, opacity: 0.8, dashArray: '5 4' })
      .bindPopup(popup, { className: 'tw-popup' })
      .addTo(_group);
  });
}

// ── UTILS ─────────────────────────────────────────────────────────────────────

function bboxKey(bounds) {
  return [
    bounds.getSouth().toFixed(2), bounds.getWest().toFixed(2),
    bounds.getNorth().toFixed(2), bounds.getEast().toFixed(2),
  ].join(',');
}

export function getHabitatLegend() {
  return HABITAT_SPECIES.map(({ key, name, color }) => ({ key, name, color }));
}
