// ── SPEARFISHING CLOSURE ZONES ────────────────────────────────────────────────
// NSW Aquatic Reserves from ArcGIS Online (NSW DPI / OEH).
// Source: NSW_Aquatic_Reserves FeatureServer layer — open public data.
// Falls back to the backend proxy (/api/marine/restrictions) if CORS fails.

const ARCGIS_URL =
  'https://services.arcgis.com/xDL0LTy98rbQTFbo/arcgis/rest/services/NSW_Aquatic_Reserves/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&f=geojson&resultRecordCount=500';

let _map     = null;
let _layer   = null;
let _visible = true;
let _loaded  = false;

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initClosuresLayer(map) {
  _map   = map;
  _layer = L.geoJSON(null, {
    style:          closureStyle,
    onEachFeature:  (feature, layer) => {
      layer.bindPopup(buildPopup(feature.properties), { className: 'tw-popup', maxWidth: 280 });
    },
  });
  loadFromArcGIS();
}

export function setClosuresVisible(on) {
  _visible = on;
  if (on)  { if (!_map.hasLayer(_layer)) _layer.addTo(_map); }
  else     { if (_map.hasLayer(_layer))  _map.removeLayer(_layer); }
}

// ── DATA LOADING ─────────────────────────────────────────────────────────────

async function loadFromArcGIS() {
  try {
    const resp = await fetch(ARCGIS_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const geojson = await resp.json();
    if (!geojson?.features?.length) throw new Error('empty');
    _layer.addData(geojson);
    _loaded = true;
    if (_visible) _layer.addTo(_map);
  } catch {
    // ArcGIS unreachable — fall back to hardcoded NSW reserves via backend
    loadFallback();
  }
}

async function loadFallback() {
  try {
    const resp = await fetch(
      '/api/marine/restrictions?minLat=-37.5&minLng=149.0&maxLat=-28.0&maxLng=154.0'
    );
    if (!resp.ok) return;
    const geojson = await resp.json();
    _layer.addData(geojson);
    if (_visible) _layer.addTo(_map);
  } catch { /* no data available */ }
}

// ── STYLING ───────────────────────────────────────────────────────────────────

function closureStyle() {
  return {
    color:       '#ff5f6d',
    fillColor:   '#ff5f6d',
    fillOpacity: 0.15,
    weight:      1.5,
    opacity:     0.8,
    dashArray:   '5 4',
  };
}

function buildPopup(props) {
  if (!props) props = {};
  // ArcGIS field names vary; try common patterns
  const name  = props.NAME       || props.RESERVE_NAME || props.name       || 'NSW Aquatic Reserve';
  const cls   = props.CLASS      || props.RESERVE_TYPE || props.rule        || '';
  const notes = props.NOTES      || props.DESCRIPTION  || '';
  const area  = props.AREA_SQKM  || props.AREA_HA      || '';

  return `<div style="font-family:'Noto Sans',monospace">
    <div style="font-size:11px;color:#ff5f6d;margin-bottom:5px;font-weight:600">⚠ ${escHtml(name)}</div>
    ${cls   ? `<div style="font-size:10px;color:#b8d4e8;margin-bottom:3px">${escHtml(cls)}</div>`   : ''}
    ${notes ? `<div style="font-size:10px;color:#3a5a78;margin-bottom:3px">${escHtml(notes)}</div>` : ''}
    ${area  ? `<div style="font-size:9px;color:#3a5a78;margin-bottom:3px">Area: ${escHtml(String(area))}</div>` : ''}
    <div style="font-size:9px;color:#ff5f6d;margin-top:6px;line-height:1.5">
      Spearfishing prohibited in this reserve.<br>
      Verify current boundaries with NSW DPI before diving.
    </div>
  </div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
