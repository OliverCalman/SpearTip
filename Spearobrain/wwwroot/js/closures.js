// ── SPEARFISHING CLOSURE ZONES + NO-TAKE ZONES ────────────────────────────────
// NSW Aquatic Reserves from ArcGIS Online (NSW DPI / OEH).
// Source: NSW_Aquatic_Reserves FeatureServer layer — open public data.
// Features are separated into:
//   • No-spearfishing (red)  — all aquatic reserves
//   • No-take / sanctuary (pink) — reserves classified as Class I or sanctuary
// Falls back to the backend proxy (/api/marine/restrictions) if CORS fails.

const ARCGIS_URL =
  'https://services.arcgis.com/xDL0LTy98rbQTFbo/arcgis/rest/services/NSW_Aquatic_Reserves/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&f=geojson&resultRecordCount=500';

let _map            = null;
let _layer          = null;   // red  — no spearfishing
let _noTakeLayer    = null;   // pink — no take / sanctuary
let _closuresOn     = true;
let _noTakeOn       = true;

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initClosuresLayer(map) {
  _map = map;

  _layer = L.geoJSON(null, {
    style:         () => closureStyle(),
    onEachFeature: (feature, layer) => {
      layer.bindPopup(buildPopup(feature.properties, false), { className: 'tw-popup', maxWidth: 280 });
    },
  });

  _noTakeLayer = L.geoJSON(null, {
    style:         () => noTakeStyle(),
    onEachFeature: (feature, layer) => {
      layer.bindPopup(buildPopup(feature.properties, true), { className: 'tw-popup', maxWidth: 280 });
    },
  });

  loadFromArcGIS();
}

export function setClosuresVisible(on) {
  _closuresOn = on;
  if (on)  { if (!_map.hasLayer(_layer))       _layer.addTo(_map); }
  else     { if (_map.hasLayer(_layer))         _map.removeLayer(_layer); }
}

export function setNoTakeVisible(on) {
  _noTakeOn = on;
  if (on)  { if (!_map.hasLayer(_noTakeLayer)) _noTakeLayer.addTo(_map); }
  else     { if (_map.hasLayer(_noTakeLayer))  _map.removeLayer(_noTakeLayer); }
}

// ── DATA LOADING ─────────────────────────────────────────────────────────────

async function loadFromArcGIS() {
  try {
    const resp = await fetch(ARCGIS_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const geojson = await resp.json();
    if (!geojson?.features?.length) throw new Error('empty');

    for (const feature of geojson.features) {
      if (isNoTake(feature.properties)) {
        _noTakeLayer.addData(feature);
      } else {
        _layer.addData(feature);
      }
    }

    if (_closuresOn) _layer.addTo(_map);
    if (_noTakeOn)   _noTakeLayer.addTo(_map);
  } catch {
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
    if (_closuresOn) _layer.addTo(_map);
  } catch { /* no data available */ }
}

// Determine if a reserve feature is a no-take / sanctuary zone.
// NSW DPI fields vary; check common patterns across field names.
function isNoTake(props) {
  if (!props) return false;
  const vals = Object.values(props).map(v => String(v ?? '').toLowerCase());
  return vals.some(v =>
    v.includes('sanctuary') ||
    v.includes('no take') ||
    v.includes('no-take') ||
    v.includes('class i ') ||
    v === 'class i' ||
    v.includes('class 1 ') ||
    v === 'class 1'
  );
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

function noTakeStyle() {
  return {
    color:       '#ff69b4',
    fillColor:   '#ff69b4',
    fillOpacity: 0.18,
    weight:      1.5,
    opacity:     0.85,
    dashArray:   '5 4',
  };
}

function buildPopup(props, isNoTake) {
  if (!props) props = {};
  const name  = props.NAME       || props.RESERVE_NAME || props.name       || 'NSW Aquatic Reserve';
  const cls   = props.CLASS      || props.RESERVE_TYPE || props.rule        || '';
  const notes = props.NOTES      || props.DESCRIPTION  || '';
  const area  = props.AREA_SQKM  || props.AREA_HA      || '';
  const color = isNoTake ? '#ff69b4' : '#ff5f6d';
  const ruleText = isNoTake
    ? 'No-take sanctuary zone. All fishing and collection prohibited.'
    : 'Spearfishing prohibited in this reserve.';

  return `<div style="font-family:'Noto Sans',monospace">
    <div style="font-size:11px;color:${color};margin-bottom:5px;font-weight:600">⚠ ${escHtml(name)}</div>
    ${cls   ? `<div style="font-size:10px;color:#b8d4e8;margin-bottom:3px">${escHtml(cls)}</div>`   : ''}
    ${notes ? `<div style="font-size:10px;color:#3a5a78;margin-bottom:3px">${escHtml(notes)}</div>` : ''}
    ${area  ? `<div style="font-size:9px;color:#3a5a78;margin-bottom:3px">Area: ${escHtml(String(area))}</div>` : ''}
    <div style="font-size:9px;color:${color};margin-top:6px;line-height:1.5">
      ${ruleText}<br>
      Verify current boundaries with NSW DPI before diving.
    </div>
  </div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
