// ── MAP INITIALISATION & TILE MANAGEMENT ─────────────────────────────────────
import { CONFIG } from './config.js';

let _map       = null;
let _tileLayer = null;

export function initMap() {
  _map = L.map('map', {
    zoomControl:     true,
    attributionControl: true,
  }).setView(CONFIG.defaultCenter, CONFIG.defaultZoom);

  // Initial tile — Dark (CartoDB Dark Matter, dark-blue CSS filter applied).
  _tileLayer = makeTile(0);
  _tileLayer.addTo(_map);
  _map.getContainer().classList.add('tile-dark');

  // Tile buttons
  document.querySelectorAll('.tile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.tile);
      setTile(i);
      document.querySelectorAll('.tile-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  return _map;
}

function makeTile(i) {
  const t = CONFIG.tiles[i];
  return L.tileLayer(t.url, { attribution: t.attr, maxZoom: 19 });
}

export function setTile(i) {
  if (_map.hasLayer(_tileLayer)) _map.removeLayer(_tileLayer);
  _tileLayer = makeTile(i);
  _tileLayer.addTo(_map);
  _map.getContainer().classList.toggle('tile-dark', i === 0);
}

export function getMap() { return _map; }
