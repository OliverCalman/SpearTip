// ── SPEARFISHING CLOSURE ZONES + NO-COLLECTING ZONES ─────────────────────────
// Two separate NSW DPI ArcGIS FeatureServer layers (no API key, CORS-enabled):
//
//   NSW_Aquatic_Reserves (14 features, Sydney + coast) - all prohibit spearfishing (red)
//     Field D_ZONETYPE_1: "Aquatic Reserve" or "Aquatic Reserve (Sanctuary)"
//
//   NSW_Marine_Parks (273 features, 6 parks) - sorted by zone type:
//     "Sanctuary Zone"                            → red  (no spearfishing)
//     "Habitat Protection Zone (Restrictions...)" → yellow (collecting restricted,
//                                                           spearfishing allowed)
//     "General Use Zone"                          → yellow (bag limits on collecting)
//     "Special Purpose Zone"                      → red  (case-by-case, treated cautiously)
//
// Zones are added to BOTH layers where they restrict BOTH activities:
//   All Aquatic Reserves → red + yellow (prohibit spearfishing AND collecting)
//   Marine Park Sanctuary / Special Purpose → red + yellow
//   Marine Park Habitat Protection / General Use → yellow only (spearfishing allowed)
// Falls back to the backend proxy (/api/marine/restrictions) if both fetches fail.

const ARCGIS_URL =
  'https://services.arcgis.com/xDL0LTy98rbQTFbo/arcgis/rest/services/NSW_Aquatic_Reserves/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&f=geojson&resultRecordCount=500';

const MARINE_PARKS_URL =
  'https://services.arcgis.com/xDL0LTy98rbQTFbo/arcgis/rest/services/NSW_Marine_Parks/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&f=geojson&resultRecordCount=500';

let _map            = null;
let _layer          = null;   // red  - no spearfishing
let _noTakeLayer    = null;   // yellow - collecting restricted, spearfishing allowed
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
  if (on) {
    if (!_map.hasLayer(_layer)) _layer.addTo(_map);
    _layer.bringToFront();
  } else {
    if (_map.hasLayer(_layer)) _map.removeLayer(_layer);
  }
}

export function setNoTakeVisible(on) {
  _noTakeOn = on;
  if (on) {
    if (!_map.hasLayer(_noTakeLayer)) _noTakeLayer.addTo(_map);
    // Keep red on top after yellow is added
    if (_closuresOn && _map.hasLayer(_layer)) _layer.bringToFront();
  } else {
    if (_map.hasLayer(_noTakeLayer)) _map.removeLayer(_noTakeLayer);
  }
}

// ── DATA LOADING ─────────────────────────────────────────────────────────────

async function loadFromArcGIS() {
  const [aquaticResult, marineResult] = await Promise.allSettled([
    fetch(ARCGIS_URL),
    fetch(MARINE_PARKS_URL),
  ]);

  let anyLoaded = false;

  // NSW Aquatic Reserves - prohibit BOTH spearfishing AND collecting, so add to both layers.
  // When "No Spearfishing" is toggled off, the yellow layer still shows these zones.
  if (aquaticResult.status === 'fulfilled' && aquaticResult.value.ok) {
    const geojson = await aquaticResult.value.json();
    for (const feature of (geojson.features || [])) {
      _layer.addData(feature);
      _noTakeLayer.addData(feature);
      anyLoaded = true;
    }
  }

  // NSW Marine Parks - classify by D_ZONETYPE_1:
  //   Sanctuary / Special Purpose → both layers (no spearfishing + no collecting)
  //   Habitat Protection / General Use → yellow only (collecting restricted, spearfishing ok)
  if (marineResult.status === 'fulfilled' && marineResult.value.ok) {
    const geojson = await marineResult.value.json();
    for (const feature of (geojson.features || [])) {
      if (isSpearfishingZone(feature.properties)) _layer.addData(feature);
      if (isCollectingZone(feature.properties))   _noTakeLayer.addData(feature);
      anyLoaded = true;
    }
  }

  if (!anyLoaded) { loadFallback(); return; }

  // Add yellow first so red renders on top when both are visible
  if (_noTakeOn)   _noTakeLayer.addTo(_map);
  if (_closuresOn) _layer.addTo(_map);
}

async function loadFallback() {
  try {
    const resp = await fetch(
      '/api/marine/restrictions?minLat=-37.5&minLng=149.0&maxLat=-28.0&maxLng=154.0'
    );
    if (!resp.ok) return;
    const geojson = await resp.json();

    // Hardcoded reserves prohibit both spearfishing and collecting - add to both layers
    for (const feature of (geojson.features || [])) {
      _layer.addData(feature);
      _noTakeLayer.addData(feature);
    }

    // Add yellow first so red renders on top when both are visible
    if (_noTakeOn)   _noTakeLayer.addTo(_map);
    if (_closuresOn) _layer.addTo(_map);
  } catch { /* no data available */ }
}

// Marine Park zones where spearfishing is prohibited (→ red layer)
function isSpearfishingZone(props) {
  if (!props) return false;
  const vals = Object.values(props).map(v => String(v ?? '').toLowerCase());
  return vals.some(v =>
    v.includes('sanctuary') ||
    v.includes('special purpose') ||
    v.includes('no fishing') ||
    v.includes('spearfishing')
  );
}

// Marine Park zones where collecting is restricted (→ yellow layer)
// Sanctuary = all collection prohibited; HP/GU = benthic collection restricted
function isCollectingZone(props) {
  if (!props) return false;
  const vals = Object.values(props).map(v => String(v ?? '').toLowerCase());
  return vals.some(v =>
    v.includes('sanctuary') ||
    v.includes('habitat protection') ||
    v.includes('general use')
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
    color:       '#ffd700',
    fillColor:   '#ffd700',
    fillOpacity: 0.18,
    weight:      1.5,
    opacity:     0.85,
    dashArray:   '5 4',
  };
}

function buildPopup(props, isNoTake) {
  if (!props) props = {};
  // ArcGIS NSW DPI field names: C_NAME_1 (zone name), B_SUBTYPE_1 (reserve/park name),
  // D_ZONETYPE_1 (zone type), F_POPUPINFO (rules text), AREA_HA (area)
  const name  = props.C_NAME_1   || props.B_SUBTYPE_1  || props.NAME || props.name || 'NSW Protected Area';
  const cls   = props.D_ZONETYPE_1 || props.CLASS      || props.rule || '';
  const notes = props.F_POPUPINFO || props.NOTES       || props.DESCRIPTION || '';
  const area  = props.AREA_HA    || props.AREA_SQKM    || '';
  const color = isNoTake ? '#ffd700' : '#ff5f6d';
  const ruleText = isNoTake
    ? 'Collecting of marine life (urchins, cunjevoi, etc.) is restricted or prohibited in this zone.'
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
