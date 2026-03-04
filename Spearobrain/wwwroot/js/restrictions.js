// ── NSW DPI NO-SPEARFISHING ZONES ─────────────────────────────────────────────
// Data: NSW Environment GeoServer WFS (proxied), with hardcoded fallback.
// Zones are aquatic reserves and marine park sanctuary zones.
import { CONFIG } from './config.js';

let _map       = null;
let _group     = null;
let _visible   = true;
let _loaded    = false;

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initRestrictionsLayer(map) {
  _map   = map;
  _group = L.layerGroup().addTo(map);

  // Load restrictions for the initial view + on significant pan
  loadRestrictions();
  map.on('moveend', () => {
    if (!_loaded) loadRestrictions();
  });
}

export function setRestrictionsVisible(on) {
  _visible = on;
  if (on)  _group.addTo(_map);
  else     _map.removeLayer(_group);
}

// Check if a given lat/lng falls inside any no-spearfishing zone.
// Returns the zone feature or null.
export function getRestrictionAt(lat, lng) {
  let found = null;
  _group.eachLayer(layer => {
    if (found) return;
    if (layer.getBounds && layer.getBounds().contains([lat, lng])) {
      const props = layer.feature?.properties;
      if (props?.noSpearfishing) found = props;
    }
  });
  return found;
}

// ── FETCH & RENDER ────────────────────────────────────────────────────────────

async function loadRestrictions() {
  if (_loaded) return;

  try {
    const b     = _map.getBounds().pad(0.3);
    const url   = `${CONFIG.api.restrictions}?minLat=${b.getSouth().toFixed(3)}&minLng=${b.getWest().toFixed(3)}&maxLat=${b.getNorth().toFixed(3)}&maxLng=${b.getEast().toFixed(3)}`;
    const resp  = await fetch(url);
    if (!resp.ok) throw new Error('Restrictions API error');
    const data  = await resp.json();
    renderGeoJSON(data);
    _loaded = true;
  } catch {
    // If proxy also fails, the hardcoded data is already returned by backend
    // so this path only triggers on complete network failure
    console.warn('Restrictions layer: using cached data');
  }
}

function renderGeoJSON(featureCollection) {
  _group.clearLayers();

  if (!featureCollection?.features) return;

  featureCollection.features.forEach(feature => {
    if (!feature.geometry) return;

    const props = feature.properties || {};
    const layer = L.geoJSON(feature, {
      style: {
        color:       '#ff5f6d',
        fillColor:   '#ff5f6d',
        fillOpacity: 0.15,
        weight:      2,
        dashArray:   '6 4',
        opacity:     0.8,
      },
    });

    // Attach feature reference for getRestrictionAt()
    layer.eachLayer(l => {
      l.feature = feature;
      l.bindPopup(buildRestrictionPopup(props), { className: 'restriction-popup' });
    });

    layer.addTo(_group);

    // Label
    if (feature.geometry.type === 'Polygon') {
      const coords = feature.geometry.coordinates[0];
      const center = centroid(coords);
      L.marker(center, {
        icon: L.divIcon({
          className: '',
          html: `<div style="
            background:rgba(255,95,109,.15);border:1px solid rgba(255,95,109,.5);
            border-radius:5px;padding:2px 6px;font-family:'Noto Sans',monospace;
            font-size:9px;color:#ff5f6d;white-space:nowrap;text-align:center;
            box-shadow:0 0 8px rgba(255,95,109,.2)">
            NO SPEARFISH
          </div>`,
          iconAnchor: [40, 10],
        }),
      })
      .bindPopup(buildRestrictionPopup(props), { className: 'restriction-popup' })
      .addTo(_group);
    }
  });

  if (_visible) _group.addTo(_map);
}

function buildRestrictionPopup(props) {
  return `<div style="font-family:'Noto Sans',monospace">
    <div style="font-size:12px;color:#ff5f6d;margin-bottom:6px">${props.name || 'Protected Area'}</div>
    <div style="font-size:11px;color:#b8d4e8;margin-bottom:6px">${props.rule || 'Spearfishing prohibited'}</div>
    <div style="font-size:10px;color:#3a5a78">
      Verify boundaries with <a href="https://www.dpi.nsw.gov.au/fishing/marine-protected-areas" target="_blank" style="color:#ff5f6d">NSW DPI</a>
    </div>
  </div>`;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function centroid(coords) {
  // coords = array of [lng, lat] from GeoJSON
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  return [lat, lng];
}
