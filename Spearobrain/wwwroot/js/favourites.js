// ── FAVOURITE LOCATIONS ───────────────────────────────────────────────────────
// Persisted in a cookie (speartips_favs) once the user accepts cookie consent.
// Without consent favourites still work for the session but are not saved.

const STORAGE_KEY = 'speartips_favs';
const CONSENT_KEY = 'speartips_consent';

let _map          = null;
let _group        = null;
let _favs         = [];
let _markers      = {};
let _openCallback = null;

// ── PUBLIC ────────────────────────────────────────────────────────────────────

export function initFavourites(map, openCallback = null) {
  _map          = map;
  _openCallback = openCallback;
  _group        = L.layerGroup().addTo(map);
  _favs         = load();
  renderAll();
  renderFavsBar();

  // Persist any in-session favourites once the user grants consent
  window.addEventListener('speartips:consent', () => save());
}

export function addFavourite(lat, lng, name, note = '') {
  const id  = Date.now().toString(36);
  const fav = { id, name, lat, lng, note, added: new Date().toISOString() };
  _favs.push(fav);
  save();
  addMarker(fav);
  renderFavsBar();
  return fav;
}

export function removeFavourite(id) {
  _favs = _favs.filter(f => f.id !== id);
  save();
  if (_markers[id]) { _map.removeLayer(_markers[id]); delete _markers[id]; }
  renderFavsBar();
}

export function isFavourite(lat, lng) {
  return _favs.some(f => Math.abs(f.lat - lat) < 0.001 && Math.abs(f.lng - lng) < 0.001);
}

export function getFavourites() { return [..._favs]; }

// ── FAVOURITES BAR ────────────────────────────────────────────────────────────

function renderFavsBar() {
  const bar   = document.getElementById('favs-bar');
  const label = document.getElementById('favs-label');
  if (!bar) return;

  if (_favs.length === 0) {
    bar.innerHTML = '';
    if (label) label.style.display = 'none';
    return;
  }
  if (label) label.style.display = '';

  bar.innerHTML = _favs.map(f => `
    <div class="fav-card" data-fav-id="${f.id}">
      <span class="fav-icon">★</span>
      <span class="fav-name">${escHtml(f.name)}</span>
      <span class="fav-del" data-fav-del="${f.id}" title="Remove">✕</span>
    </div>`).join('');

  bar.querySelectorAll('.fav-card').forEach(card => {
    const id  = card.dataset.favId;
    const fav = _favs.find(f => f.id === id);
    if (!fav) return;
    card.addEventListener('click', e => {
      if (e.target.dataset.favDel) return;
      _map.flyTo([fav.lat, fav.lng], 15, { duration: 1.2 });
      if (_openCallback) _openCallback(fav.lat, fav.lng, fav.name);
    });
  });

  bar.querySelectorAll('[data-fav-del]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeFavourite(btn.dataset.favDel);
    });
  });
}

// ── MARKERS ───────────────────────────────────────────────────────────────────

function renderAll() {
  _group.clearLayers();
  _markers = {};
  _favs.forEach(fav => addMarker(fav));
}

function addMarker(fav) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="font-size:20px;text-shadow:0 0 8px rgba(255,179,71,.7);
      cursor:pointer;line-height:1;user-select:none">★</div>`,
    iconAnchor: [10, 18],
  });

  const marker = L.marker([fav.lat, fav.lng], { icon })
    .bindPopup(buildFavPopup(fav), { className: 'tw-popup', maxWidth: 200 });

  marker.addTo(_group);
  _markers[fav.id] = marker;
}

function buildFavPopup(fav) {
  const date = new Date(fav.added).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' });
  return `<div style="font-family:'Noto Sans',monospace">
    <div style="font-size:12px;color:#ffb347;margin-bottom:6px">★ ${escHtml(fav.name)}</div>
    <div style="font-size:11px;color:#b8d4e8;margin-bottom:4px">
      ${fav.lat.toFixed(4)}°S  ${fav.lng.toFixed(4)}°E
    </div>
    ${fav.note ? `<div style="font-size:10px;color:#3a5a78;margin-bottom:6px">${escHtml(fav.note)}</div>` : ''}
    <div style="font-size:9px;color:#3a5a78">Saved ${date}</div>
    <div style="margin-top:8px">
      <button onclick="window.__removeFav('${fav.id}')" style="
        background:rgba(255,95,109,.1);border:1px solid rgba(255,95,109,.3);border-radius:4px;
        color:#ff5f6d;font-size:10px;padding:2px 8px;cursor:pointer;font-family:'Noto Sans',monospace">
        Remove
      </button>
    </div>
  </div>`;
}

window.__removeFav = id => { removeFavourite(id); _map.closePopup(); };

// ── COOKIE PERSISTENCE ────────────────────────────────────────────────────────

function isConsentGiven() {
  return new RegExp('(?:^|;\\s*)' + CONSENT_KEY + '=1').test(document.cookie);
}

function save() {
  if (!isConsentGiven()) return;
  try {
    document.cookie =
      `${STORAGE_KEY}=${encodeURIComponent(JSON.stringify(_favs))};max-age=31536000;path=/;SameSite=Lax`;
  } catch { /* blocked */ }
}

function load() {
  try {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + STORAGE_KEY + '=([^;]*)'));
    return m ? JSON.parse(decodeURIComponent(m[1])) : [];
  } catch { return []; }
}

// ── UTILS ─────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
